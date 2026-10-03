"""Run the pinned external TIGER worker, then validate sample-aligned stems."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
MEDIA = HERE / 'media'
TOOLS = Path.home() / '.cache/mochi-audio-tools'
REFERENCE = Path('/Users/a1379/Desktop/AI模型宣传视频/Kimi_K2.5_全能Agent模型.mp4')
WORKER_COMMIT = '7448d47a942b43ae2fc37ecc8fe0bc731c9e18fc'
MODEL_REVISION = 'b7a59560bbca10febbcd46fb01600f868e587f57'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

parser = argparse.ArgumentParser()
parser.add_argument('--check-only', action='store_true')
args = parser.parse_args()
MEDIA.mkdir(exist_ok=True)
if not args.check_only:
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(REFERENCE),
                    '-vn', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_f32le',
                    str(MEDIA / 'separation-input.wav')], check=True)
    env = {**os.environ, 'PYTHONPATH': str(TOOLS / 'stem-studio/python'),
           'STEMSTUDIO_DEVICE': 'mps', 'STEMSTUDIO_ENABLE_UNLICENSED_ENGINES': '0',
           'STEMSTUDIO_ENABLE_TEST_ENGINES': '0'}
    subprocess.run([str(TOOLS / 'venv/bin/python'), '-m', 'stemstudio_worker.separate',
                    '--input', str(MEDIA / 'separation-input.wav'),
                    '--outdir', str(MEDIA / 'stems'), '--engine', 'tiger',
                    '--quality', 'fast', '--cache-dir', str(TOOLS / 'models')],
                   env=env, check=True)

source, rate = sf.read(MEDIA / 'separation-input.wav', dtype='float32', always_2d=True)
assert rate == 44100 and source.shape[1] == 2
stems, stats = {}, {}
for name in ('music', 'effects', 'dialogue'):
    path = MEDIA / f'stems/{name}.wav'
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    assert sr == rate and x.shape == source.shape and np.isfinite(x).all(), name
    stems[name] = x
    stats[name] = {'sha256': sha(path), 'rms': float(np.sqrt(np.mean(x**2))),
                   'peak': float(np.max(np.abs(x)))}
residual = float(np.max(np.abs(source - sum(stems.values()))))
assert residual < 1e-6, residual
assert stats['music']['rms'] > .001 and stats['effects']['rms'] > .0001
assert not np.array_equal(stems['music'], source)
report = {'worker': 'https://github.com/wassermanproductions/stem-studio',
          'workerCommit': WORKER_COMMIT, 'model': 'JusperLee/TIGER-DnR',
          'workerSourceSha256': {name: sha(TOOLS / 'stem-studio/python/stemstudio_worker' / name)
                                for name in ('engine_tiger.py', 'pipeline.py', 'vendor/tiger/tiger_dnr.py')},
          'modelRevision': MODEL_REVISION, 'engine': 'tiger', 'quality': 'fast', 'device': 'mps',
          'referenceSha256': sha(REFERENCE), 'inputSha256': sha(MEDIA / 'separation-input.wav'),
          'musicSha256': stats['music']['sha256'], 'stems': stats,
          'sampleRate': rate, 'samplesPerChannel': len(source), 'duration': len(source)/rate,
          'maxMixtureReconstructionError': residual,
          'finalMixIncludes': ['separated music', 'Mochi click', 'Mochi typing', 'Mochi ding'],
          'finalMixExcludes': ['reference effects stem', 'reference dialogue stem'],
          'limitation': 'Separation can leave bleed or alter transients. Reconstruction and RMS checks are not proof of perfect isolation.',
          'manualListeningVerified': False}
(HERE / 'separation-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
