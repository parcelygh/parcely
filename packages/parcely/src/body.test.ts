import { describe, it, expect } from 'vitest';
import { prepareBody } from './body.js';

describe('prepareBody', () => {
  it('returns undefined body for null/undefined', () => {
    expect(prepareBody(null, {}).body).toBeUndefined();
    expect(prepareBody(undefined, {}).body).toBeUndefined();
  });

  it('passes string through', () => {
    const result = prepareBody('hello', {});
    expect(result.body).toBe('hello');
  });

  it('passes Blob through and infers content-type', () => {
    const blob = new Blob(['data'], { type: 'image/png' });
    const result = prepareBody(blob, {});
    expect(result.body).toBe(blob);
    expect(result.headers?.['content-type']).toBe('image/png');
  });

  it('does not set content-type for Blob when user already set it', () => {
    const blob = new Blob(['data'], { type: 'image/png' });
    const result = prepareBody(blob, {
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(result.headers?.['content-type']).toBeUndefined();
  });

  it('passes ArrayBuffer through', () => {
    const buf = new ArrayBuffer(4);
    const result = prepareBody(buf, {});
    expect(result.body).toBe(buf);
  });

  it('passes ReadableStream through', () => {
    const stream = new ReadableStream();
    const result = prepareBody(stream, {});
    expect(result.body).toBe(stream);
  });

  it('JSON-stringifies plain objects', () => {
    const result = prepareBody({ name: 'test' }, {});
    expect(result.body).toBe('{"name":"test"}');
    expect(result.headers?.['content-type']).toBe('application/json');
  });

  it('does not set content-type for JSON when user-set', () => {
    const result = prepareBody({ name: 'test' }, {
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(result.headers?.['content-type']).toBeUndefined();
  });

  it('passes FormData through with correct content-type', () => {
    const fd = new FormData();
    fd.append('key', 'value');
    const result = prepareBody(fd, {});
    expect(result.headers?.['content-type']).toContain('multipart/form-data');
  });

  // Auto-FormData conversion
  it('auto-converts plain object with File/Blob to FormData (brackets serializer)', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    const result = prepareBody(
      { avatar: blob, name: 'test', tags: ['a', 'b'] },
      { formDataSerializer: 'brackets' },
    );
    // Should produce multipart content-type
    const ct = result.headers?.['content-type'] ?? '';
    expect(ct).toContain('multipart/form-data');
    // Read back using the content-type so Response can parse FormData
    const resp = new Response(result.body as BodyInit, {
      headers: { 'content-type': ct },
    });
    const fd = await resp.formData();
    expect(fd.get('name')).toBe('test');
    expect(fd.get('avatar')).toBeInstanceOf(Blob);
    // brackets serializer (axios-compatible): tags[]=a, tags[]=b — both
    // entries appear under the same `tags[]` key, retrievable via getAll.
    expect(fd.getAll('tags[]')).toEqual(['a', 'b']);
    // And the indexed form (`tags[0]`) must NOT exist — that's the indices
    // serializer's behaviour.
    expect(fd.get('tags[0]')).toBeNull();
  });

  it('auto-converts with indices serializer', async () => {
    const blob = new Blob(['img']);
    const result = prepareBody(
      { file: blob, items: ['x', 'y'] },
      { formDataSerializer: 'indices' },
    );
    const ct = result.headers?.['content-type'] ?? '';
    const resp = new Response(result.body as BodyInit, {
      headers: { 'content-type': ct },
    });
    const fd = await resp.formData();
    expect(fd.get('items[0]')).toBe('x');
    expect(fd.get('items[1]')).toBe('y');
  });

  it('auto-converts with repeat serializer', async () => {
    const blob = new Blob(['img']);
    const result = prepareBody(
      { file: blob, items: ['x', 'y'] },
      { formDataSerializer: 'repeat' },
    );
    const ct = result.headers?.['content-type'] ?? '';
    const resp = new Response(result.body as BodyInit, {
      headers: { 'content-type': ct },
    });
    const fd = await resp.formData();
    expect(fd.getAll('items')).toEqual(['x', 'y']);
  });

  it('auto-converts nested objects with bracket serializer', async () => {
    const blob = new Blob(['img']);
    const result = prepareBody(
      { file: blob, owner: { id: '42', name: 'Mickey' } },
      { formDataSerializer: 'brackets' },
    );
    const ct = result.headers?.['content-type'] ?? '';
    const resp = new Response(result.body as BodyInit, {
      headers: { 'content-type': ct },
    });
    const fd = await resp.formData();
    expect(fd.get('owner[id]')).toBe('42');
    expect(fd.get('owner[name]')).toBe('Mickey');
  });

  it('does NOT auto-convert to FormData when no File/Blob values', () => {
    const result = prepareBody({ name: 'test', count: 5 }, {});
    expect(result.body).toBe('{"name":"test","count":5}');
    expect(result.headers?.['content-type']).toBe('application/json');
  });
});
