export const FIXED_SUBSCRIPTION_KEY = 'fixed:subscription';

export function createDefaultFixedRecord() {
  return {
    version: 1,
    namePrefix: 'Default',
    nodeLinks: '',
    keepOriginalHost: true,
    preferredIps: [],
    preferredCount: 0,
    candidateCount: 0,
    candidateMode: 'hybrid',
    preferredPreview: [],
    lastOptimizedAt: null,
    updatedFrom: '',
    latestRunStatus: {
      state: 'idle',
      message: '尚未执行 Top200 优选。',
      startedAt: null,
      finishedAt: null,
      preferredCount: 0,
      candidateCount: 0,
      candidateMode: 'hybrid',
      tlsMode: 'tls',
    },
  };
}

export async function readFixedRecord(env) {
  const raw = await env.SUB_STORE.get(FIXED_SUBSCRIPTION_KEY);
  if (!raw) {
    return createDefaultFixedRecord();
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...createDefaultFixedRecord(),
      ...parsed,
      latestRunStatus: {
        ...createDefaultFixedRecord().latestRunStatus,
        ...(parsed.latestRunStatus || {}),
      },
      preferredIps: Array.isArray(parsed.preferredIps) ? parsed.preferredIps : [],
      preferredPreview: Array.isArray(parsed.preferredPreview) ? parsed.preferredPreview : [],
    };
  } catch {
    return createDefaultFixedRecord();
  }
}

export async function writeFixedRecord(env, record) {
  await env.SUB_STORE.put(FIXED_SUBSCRIPTION_KEY, JSON.stringify(record, null, 2));
  return record;
}

export async function updateFixedRecord(env, updater) {
  const current = await readFixedRecord(env);
  const next = await updater(current);
  await writeFixedRecord(env, next);
  return next;
}
