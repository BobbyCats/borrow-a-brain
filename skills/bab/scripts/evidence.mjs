import {boundedString} from './store.mjs';

export const materialKinds = ['text', 'webpage', 'document', 'pdf', 'audio', 'video', 'image', 'book', 'meeting', 'chat'];

// Shared optional receipt; old text-only records remain readable without migration.
export function materialReceipt(value) {
  if (value === undefined) return {};
  if (!value || !materialKinds.includes(value.kind)) throw new Error('材料类型无效。');
  if (!['full', 'partial', 'unavailable'].includes(value.coverage)) throw new Error('材料覆盖范围应为 full / partial / unavailable。');
  if (!['host-native', 'text', 'ocr', 'asr', 'subtitles', 'vision', 'mixed', 'unavailable'].includes(value.extraction)) throw new Error('材料读取方式无效。');
  if (value.extraction === 'unavailable' && value.coverage !== 'unavailable') throw new Error('未能读取的材料不能标为完整或部分已读。');
  const material = {kind: value.kind, coverage: value.coverage, extraction: value.extraction};
  for (const key of ['title', 'locator', 'inspected', 'omitted', 'uncertainty', 'identity', 'origin']) material[key] = boundedString(value[key], `材料 ${key}`, 2000);
  if (value.library !== undefined) {
    const ref = value.library;
    if (!ref || !Number.isInteger(ref.revision) || ref.revision < 1 || !/^[a-f0-9]{64}$/u.test(ref.sha256 || '')) throw new Error('素材库引用需要精确版本和 SHA-256。');
    material.library = {id: boundedString(ref.id, '素材编号', 100), revision: ref.revision, sha256: ref.sha256};
  }
  return {material};
}

