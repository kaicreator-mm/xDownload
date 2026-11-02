import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFormDescriptor, validatePreviewUrl } from '../src/renderer/form-schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8');
const renderer = readFileSync(join(root, 'src/renderer/renderer-main.ts'), 'utf8');

describe('UI R0 trusted dynamic form descriptor', () => {
  it('exposes only a known, versioned, confirm-first operation', () => {
    const form = getFormDescriptor('url-preview');
    expect(form?.schemaVersion).toBe(1);
    expect(form?.requiresCoreConfirmation).toBe(true);
    expect(form?.fields.map((f) => f.id)).toEqual(['url']);
    expect(getFormDescriptor('hls')).toBeNull();
    expect(getFormDescriptor('batch')).toBeNull();
    expect(getFormDescriptor('arbitrary-privileged-action')).toBeNull();
  });

  it('rejects unsafe URL shapes locally without authorizing a command', () => {
    for (const raw of [
      '',
      '  https://example.test/a',
      'ftp://example.test/a',
      'https://name:secret@example.test/private',
      'bad url',
      'https://example.test/' + 'a'.repeat(8192),
    ]) {
      expect(validatePreviewUrl(raw).ok, raw.slice(0, 50)).toBe(false);
    }
    expect(validatePreviewUrl('https://example.test/download.zip').ok).toBe(true);
    expect(validatePreviewUrl('http://example.test/a').ok).toBe(true);
  });
});

describe('UI R0 renderer containment and user navigation', () => {
  it('keeps existing IPC bridge, Core preview and destructive confirmation split', () => {
    for (const method of [
      'managerRefresh',
      'managerPreviewAdd',
      'managerConfirmAdd',
      'managerDiscardPreview',
      'managerCancelJob',
      'managerRetryJob',
    ]) {
      expect(renderer).toContain('BRIDGE.' + method);
    }
    expect(renderer).toContain('window.xdownloadShell');
    expect(renderer).toContain('renderFormFields()');
    expect(renderer).toContain("getFormDescriptor('url-preview')");
  });
  it('exposes user-familiar navigation with accessible localized state and no fake bytes', () => {
    expect(html).toContain('lang="zh-CN"');
    for (const id of [
      'app',
      'new-download',
      'job-search',
      'empty-state',
      'filter-empty',
      'add-dialog',
      'preview',
      'job-details',
      'jobs-table',
      'jobs-body',
      'form-fields',
      'connection-line',
      'bridge-missing',
    ]) {
      expect(html).toContain('id="' + id + '"');
    }
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('aria-modal="true"');
    expect(renderer).toContain('暂无可靠字节进度');
    expect(renderer).not.toContain('innerHTML');
  });
  it('describes only the fields that the task search actually indexes', () => {
    expect(html).toContain('placeholder="搜索来源、状态或失败原因"');
    expect(html).not.toContain('placeholder="搜索链接来源、状态或目录"');
    expect(renderer).toContain('[taskLabel(row), statusLabel(row), row.terminal?.stopReason ?? \'\']');
  });

  it('keeps unsupported destination selection and reveal controls out of the renderer', () => {
    expect(html).not.toContain('id="destination-label"');
    expect(html).not.toContain('id="choose-destination"');
    expect(renderer).not.toContain('choose-destination');
    expect(renderer).not.toContain('destination.id');
    expect(renderer).not.toContain('browse.id');
  });

  it('hides lineage IDs from the ordinary list and requires every Core completion dimension', () => {
    expect(renderer).not.toContain('row.lineageId.slice');
    expect(renderer).toContain("byId('details-lineage').textContent = current.lineageId");
    for (const marker of [
      "terminal.targetResolution === 'RESOLVED'",
      "terminal.selectionAcquisition === 'COMPLETE'",
      "terminal.coverage === 'VERIFIED_COMPLETE'",
      "terminal.requestFulfillment === 'COMPLETE'",
      "terminal.validationSummary.status === 'ALL_PASSED'",
    ]) {
      expect(renderer).toContain(marker);
    }
    expect(html).toContain('未结束');
    expect(renderer).toContain('已提交 · 未结束');
    expect(renderer).toContain("row.lineageStatus === 'ACTIVE'");
    expect(renderer).toContain("row.lineageStatus === 'CANCELLED'");
    expect(renderer).toContain("row.lineageStatus === 'TERMINAL'");
    expect(renderer).toContain("validation.status === 'FAILED'");
    expect(renderer).toContain("validation.status === 'INSUFFICIENT_EVIDENCE'");
    expect(renderer).not.toContain("validation.status === 'NONE_PASSED'");
    expect(renderer).not.toContain("terminal.selectionAcquisition === 'ACQUIRED'");
    expect(renderer).not.toContain('runReveal');
    expect(renderer).not.toContain('managerRevealJob');
    expect(renderer).not.toContain('managerChooseDestination');
    expect(renderer).toContain('由 Core 配置管理（实际路径尚未提供）');
    expect(html).toContain('输出位置由 Core 安装配置管理');
    expect(html).toContain('当前不支持按任务自定义目录');
    expect(html).not.toContain('打开目录');
  });

  it('uses only the source host as a friendly label and keeps Core diagnostics intact', () => {
    expect(renderer).toContain("return '来源站点 · ' + parsed.host");
    expect(renderer).not.toContain('parsed.pathname');
    expect(renderer).not.toContain('parsed.search');
    expect(renderer).toContain('function localizeNotice');
    expect(renderer).toContain('Core 拒绝了');
    expect(renderer).toContain('m[3]');
    expect(renderer).toContain('Core 原始状态：');
  });
});
