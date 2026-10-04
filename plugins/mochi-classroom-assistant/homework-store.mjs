import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyLessonCommand, createLesson, appendLesson, finishLesson } from './lesson-notes.mjs';

export class HomeworkStore {
  constructor(path) {
    this.path = path;
    this.data = { version: 1, active: null, lessonActive: null, letters: [], settings: { autoStartListening: true } };
    try { this.data = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.data.version !== 1 || !Array.isArray(this.data.letters)) throw new Error('Unsupported homework store');
    this.data.lessonActive ??= null;
    this.data.settings ??= { autoStartListening: true };
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  snapshot() { return structuredClone(this.data); }
  configure(autoStartListening) {
    if (typeof autoStartListening !== 'boolean') throw new Error('Invalid listening setting');
    this.data.settings.autoStartListening = autoStartListening; this.save();
    return this.snapshot();
  }
  begin(text = '') {
    if (!this.data.active) this.data.active = { id: randomUUID(), startedAt: Date.now(), segments: [] };
    if (text) this.append(text);
    else this.save();
    return this.snapshot();
  }
  append(text) {
    if (!this.data.active) return;
    if (typeof text !== 'string' || text.length > 8000) throw new Error('Invalid transcript');
    if (this.data.active.segments.length >= 600) throw new Error('Homework transcript limit reached; finish or discard recording');
    this.data.active.segments.push({ text, at: Date.now() });
    this.save();
  }
  finish() {
    if (!this.data.active) return null;
    const active = this.data.active;
    const letter = { ...active, endedAt: Date.now(), title: '课堂作业记录', body: active.segments.map(s => s.text).join('\n'), edited: false };
    this.data.letters.push(letter);
    this.data.active = null;
    this.save();
    return structuredClone(letter);
  }
  beginLesson(command = '') {
    if (!this.data.lessonActive) {
      this.data.lessonActive = { ...createLesson({ id: randomUUID(), startedAt: Date.now() }), beginCommand: command };
      this.save();
    }
    return this.snapshot();
  }
  appendLesson(text) {
    if (!this.data.lessonActive || !text.trim()) return;
    this.data.lessonActive = appendLesson(this.data.lessonActive, { id: randomUUID(), text, at: Date.now(), source: 'local-asr' });
    this.save();
  }
  finishLesson(command = '') {
    if (!this.data.lessonActive) return null;
    const letter = { ...finishLesson(this.data.lessonActive, { endedAt: Date.now() }), endCommand: command };
    this.data.letters.push(letter); this.data.lessonActive = null; this.save();
    return structuredClone(letter);
  }
  acceptLessonTranscript(text) {
    const kind = classifyLessonCommand(text);
    if (kind === 'begin') this.beginLesson(text);
    else if (kind === 'finish') return { kind, letter: this.finishLesson(text) };
    else this.appendLesson(text);
    return { kind: kind ?? (this.data.lessonActive ? 'append' : 'ignore'), letter: null };
  }
  edit(id, body) {
    if (typeof body !== 'string' || body.length > 100000) throw new Error('Invalid letter');
    const letter = this.data.letters.find(item => item.id === id);
    if (!letter) throw new Error('Letter not found');
    letter.body = body; letter.edited = true; this.save();
    return structuredClone(letter);
  }
  discard() { this.data.active = null; this.save(); }
}

export { classifyTranscript } from './intents.mjs';
