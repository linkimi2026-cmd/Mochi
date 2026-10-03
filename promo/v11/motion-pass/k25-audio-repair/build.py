"""Rebuild K2.5 with long musical sections; keep picture and product SFX clocks."""
import json, math, subprocess, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
MEDIA = HERE / 'media'
MEDIA.mkdir(exist_ok=True)
REFERENCE = Path('/Users/a1379/Desktop/AI模型宣传视频/Kimi_K2.5_全能Agent模型.mp4')
SOURCE = MEDIA / 'stems/music.wav'
separation = json.loads((HERE / 'separation-check.json').read_text())
assert separation['musicSha256'] == hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'Validate separated music before remixing'
assert separation['referenceSha256'] == hashlib.sha256(REFERENCE.read_bytes()).hexdigest(), 'Reference changed; separate again'
timeline = json.loads((ROOT / 'timeline.json').read_text())
DURATION = round(timeline['duration'], 6)
RATE = 48000
BEAT = 60 / 114
PREROLL = .060
# Estimated 114 BPM grid from existing HyperFrames events and low-drum attacks.
# Start on the first strong attack; wrap after 20 bars, before the source outro.
SOURCE_DOWNBEAT = 4.092
LOOP_BEATS = 80
LOOP_DURATION = LOOP_BEATS * BEAT
ANCHORS = [1.15, 23.6, 47.75, 86.35, 115.45, 134.15, 184.35, 245.15, 293.25]
NAMES = ['Mo 问候', 'Agent 协作', '教学成果', '交互模型', '叮咚接信', '校园消息', '查人与教师协作', '记忆与自动化', 'Mochi 已至']

def ff(*args, capture=False):
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-y', *map(str, args)],
                          check=True, capture_output=True, text=True)

def pcm(input_path, output_path, af, start=None, duration=None):
    args = [] if start is None else ['-ss', start]
    if duration is not None:
        args += ['-t', duration]
    args += ['-i', input_path]
    ff(*args, '-vn', '-af', af, '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', output_path)

def assert_samples(path, seconds):
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate,duration_ts,time_base', '-of', 'json', str(path)]))['streams'][0]
    assert probe['sample_rate'] == str(RATE) and probe['time_base'] == f'1/{RATE}'
    assert int(probe['duration_ts']) == round(seconds*RATE), (str(path), probe, seconds)

# A 60 ms PRE-BEAT overlap preserves each incoming attack at full level.
cycle = MEDIA / 'cycle.wav'
pcm(SOURCE, cycle, f'atrim=duration={LOOP_DURATION+PREROLL},asetpts=PTS-STARTPTS',
    SOURCE_DOWNBEAT-PREROLL, LOOP_DURATION+PREROLL)
base = MEDIA / 'long-source.wav'
ff(*sum((['-i', cycle] for _ in range(3)), []), '-filter_complex',
   f'[0:a][1:a]acrossfade=d={PREROLL}:c1=tri:c2=tri[a];'
   f'[a][2:a]acrossfade=d={PREROLL}:c1=tri:c2=tri[b]',
   '-map', '[b]', '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', base)
intro = MEDIA / 'intro.wav'
pcm(SOURCE, intro, f'atrim=duration={ANCHORS[0]},asetpts=PTS-STARTPTS',
    SOURCE_DOWNBEAT-ANCHORS[0], ANCHORS[0])
sections = [intro]
report = []
for i, at in enumerate(ANCHORS):
    end = ANCHORS[i+1] if i+1 < len(ANCHORS) else DURATION
    length = end-at
    beats = round(length/BEAT)
    tempo = beats*BEAT/length if i+1 < len(ANCHORS) else 1.0
    assert abs(tempo-1) <= .015, (i, tempo)
    # Alternate the source's two musical phrases, without changing beat phase.
    offset = (56*BEAT if i in (1,3,6) else 0)
    start = PREROLL + offset - PREROLL*tempo
    output = MEDIA / f'section-{i}.wav'
    pcm(base, output,
        f'atempo={tempo},apad,atrim=duration={length+PREROLL},asetpts=PTS-STARTPTS',
        start, (length+PREROLL)*tempo+.08)
    assert_samples(output, length+PREROLL)
    sections.append(output)
    report.append({'name': NAMES[i], 'target': at, 'end': end, 'beats': beats,
                   'tempo': tempo, 'sourceOffsetBeats': round(offset/BEAT),
                   'preBeatCrossfadeSeconds': PREROLL})
    print(f'{NAMES[i]}: {at:.3f}–{end:.3f}, tempo {tempo:.6f}', flush=True)
filters = []
previous = '0:a'
for i in range(1, len(sections)):
    label = f'join{i}'
    filters.append(f'[{previous}][{i}:a]acrossfade=d={PREROLL}:c1=tri:c2=tri[{label}]')
    previous = label
filters.append(f'[{previous}]atrim=duration={DURATION},asetpts=PTS-STARTPTS[music]')
raw_music = MEDIA / 'music-unmastered.wav'
ff(*sum((['-i', s] for s in sections), []), '-filter_complex', ';'.join(filters),
   '-map', '[music]', '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', raw_music)
# Measure first, then normalize linearly. No per-transient shifts or synthetic kick accents.
measured = ff('-i', raw_music, '-af', 'loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-')
metrics = json.JSONDecoder().raw_decode(measured.stderr[measured.stderr.rfind('{'):])[0]
normalizer = ('loudnorm=I=-18:TP=-2:LRA=11:linear=true:'
              f'measured_I={metrics["input_i"]}:measured_TP={metrics["input_tp"]}:'
              f'measured_LRA={metrics["input_lra"]}:measured_thresh={metrics["input_thresh"]}:'
              f'offset={metrics["target_offset"]}')
music = MEDIA / 'music.wav'
# Ding gets a smooth 3.5 dB pocket; the title ending has a 2.2 s musical release.
ding = json.loads((ROOT / 'mail-delivery-cues.json').read_text())['effects'][0]['filmTime']
duck = f"volume='1-0.33*exp(-pow((t-{ding+.45})/.65,4))':eval=frame"
pcm(raw_music, music, f'{normalizer},{duck},afade=t=in:d=0.08,afade=t=out:st={DURATION-2.2}:d=2.2')
final = MEDIA / 'final.wav'
ff('-i', music, '-i', ROOT/'assets/clicks.wav', '-i', ROOT/'assets/typing.wav',
   '-i', ROOT/'assets/mail-ding.wav', '-filter_complex',
   f'[1:a]volume=0.8[c];[2:a]volume=0.7[t];'
   f'[3:a]adelay={round(ding*1000)}:all=1[d];'
   f'[0:a][c][t][d]amix=inputs=4:normalize=0,alimiter=limit=0.89:level=false:latency=true,'
   f'atrim=duration={DURATION}[a]', '-map', '[a]', '-ar', RATE, '-ac', 2, '-c:a', 'pcm_f32le', final)
picture_hash = subprocess.check_output(['ffmpeg','-v','error','-i',timeline['output'],'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],text=True).strip()
assert_samples(music, DURATION)
assert_samples(final, DURATION)
result = {'pictureBitstreamHash': picture_hash, 'revision': f"{timeline['edition']}.2-k25-music-stem", 'duration': DURATION, 'source': str(SOURCE),
          'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
          'reference': str(REFERENCE), 'separationReport': 'separation-check.json',
          'referenceEffectsMixed': False, 'referenceDialogueMixed': False,
          'sections': report, 'musicalSectionCount': len(report),
          'maxTempoChange': max(abs(s['tempo']-1) for s in report),
          'localAttackShifts': 0, 'syntheticKickAccents': 0,
          'musicBed': str(music), 'finalAudio': str(final),
          'finalAudioSha256': hashlib.sha256(final.read_bytes()).hexdigest(),
          'pictureChanges': False, 'dingTime': ding,
          'confirmedLegacyDrift': {'musicBedSeconds':296.594,'pictureSeconds':299.35,'missingSeconds':2.756,'cause':'Source duration passed as output -t truncated slowed slices before concatenation.'},
          'detailChanges': ['60ms pre-beat loop joins', 'typing -3.1dB', 'clicks -1.9dB',
                            'music duck 3.5dB around ding', 'ending release 2.2s'],
          'manualListeningVerified': False}
(HERE/'edit-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(final)
