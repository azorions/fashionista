import { describe, expect, it } from 'vitest';

import {
  predictionOutput,
  type Prediction,
} from '../../../supabase/functions/process-garment/prediction';

/**
 * Replicate's wait mode stops waiting after 60s and hands back the unfinished
 * prediction, which a slow cold start can easily reach. This decides what to do
 * with whatever came back. It lives beside the Edge Function and is tested from
 * here, where the tests run.
 */

const URL = 'https://replicate.test/prediction/1';
const FILE = 'https://replicate.delivery/output.png';
const fast = { timeoutMs: 1000, intervalMs: 0 };

const neverCalled = async (): Promise<Prediction> => {
  throw new Error('should not have polled');
};

/** Answers each poll with the next prediction in the list. */
function answers(...list: Prediction[]) {
  const requested: string[] = [];
  return {
    requested,
    get: async (url: string) => {
      requested.push(url);
      return list.shift() ?? { status: 'processing', urls: { get: URL } };
    },
  };
}

describe('predictionOutput', () => {
  it('uses a finished answer without polling', async () => {
    const first = { status: 'succeeded', output: FILE, urls: { get: URL } };
    await expect(predictionOutput(first, neverCalled, fast)).resolves.toBe(FILE);
  });

  it('does not wait for the status once the file is there', async () => {
    // Documented: in wait mode, file output can arrive while status is 'processing'.
    const first = { status: 'processing', output: FILE, urls: { get: URL } };
    await expect(predictionOutput(first, neverCalled, fast)).resolves.toBe(FILE);
  });

  it('takes the first file when the output is a list', async () => {
    const first = { status: 'succeeded', output: [FILE, 'other'], urls: { get: URL } };
    await expect(predictionOutput(first, neverCalled, fast)).resolves.toBe(FILE);
  });

  it('polls the prediction until the file arrives', async () => {
    const poll = answers(
      { status: 'processing', urls: { get: URL } },
      { status: 'succeeded', output: FILE, urls: { get: URL } },
    );
    const first = { status: 'starting', output: null, urls: { get: URL } };

    await expect(predictionOutput(first, poll.get, fast)).resolves.toBe(FILE);
    expect(poll.requested).toEqual([URL, URL]);
  });

  it('reports the provider reason when the prediction fails', async () => {
    const poll = answers({ status: 'failed', error: 'image too large', urls: { get: URL } });
    const first = { status: 'processing', urls: { get: URL } };

    await expect(predictionOutput(first, poll.get, fast)).rejects.toThrow('image too large');
  });

  it('fails when the prediction was canceled', async () => {
    const first = { status: 'canceled', error: null, urls: { get: URL } };
    await expect(predictionOutput(first, neverCalled, fast)).rejects.toThrow('canceled');
  });

  it('fails when it succeeds with nothing to download', async () => {
    const first = { status: 'succeeded', output: null, urls: { get: URL } };
    await expect(predictionOutput(first, neverCalled, fast)).rejects.toThrow('no image');
  });

  it('fails when an unfinished answer gives no way to check back', async () => {
    await expect(predictionOutput({ status: 'starting' }, neverCalled, fast)).rejects.toThrow(
      'no image',
    );
  });

  it('gives up at the deadline, naming how far it got', async () => {
    const poll = answers();
    const first = { status: 'starting', urls: { get: URL } };

    await expect(
      predictionOutput(first, poll.get, { timeoutMs: 0, intervalMs: 0 }),
    ).rejects.toThrow('still starting');
    expect(poll.requested).toEqual([]);
  });
});
