import { describe, expect, it } from 'vitest';

import { invokeFailure, uploadResize } from './pipeline';

describe('invokeFailure', () => {
  it('stays quiet when our function recorded the failure on the row', () => {
    // The poll will surface this reason, and it is better than anything here.
    expect(invokeFailure(500, { status: 'failed', error: 'cutout: replicate 402' })).toBeNull();
  });

  it('reports a platform rejection, which never reached our code', () => {
    const message = invokeFailure(401, { code: 'UNAUTHORIZED', message: 'Invalid JWT' });
    expect(message).toContain('401');
    expect(message).toContain('Invalid JWT');
  });

  it('reports our function refusing before it touched the row', () => {
    const message = invokeFailure(404, { error: 'image not found' });
    expect(message).toContain('404');
    expect(message).toContain('image not found');
  });

  it('reports a killed worker, whose row would otherwise spin until the timeout', () => {
    const message = invokeFailure(546, { code: 'WORKER_RESOURCE_LIMIT' });
    expect(message).toContain('546');
  });

  it('copes with a body that was not JSON', () => {
    expect(invokeFailure(502, null)).toContain('502');
  });
});

describe('uploadResize', () => {
  it('caps a portrait photo by its height', () => {
    expect(uploadResize(3024, 4032)).toEqual({ height: 2048 });
  });

  it('caps a landscape photo by its width', () => {
    expect(uploadResize(4032, 3024)).toEqual({ width: 2048 });
  });

  it('caps a square photo', () => {
    expect(uploadResize(4000, 4000)).toEqual({ width: 2048 });
  });

  it('never enlarges a photo already small enough', () => {
    expect(uploadResize(1536, 2048)).toBeNull();
    expect(uploadResize(1200, 1600)).toBeNull();
  });
});
