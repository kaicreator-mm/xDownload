/**
 * UI R0: trusted, versioned presentation-only form descriptor.
 * This is NOT a Core/Host capability or an authority token. A field can be
 * displayed only when the existing typed preload bridge already supports it.
 * Host/Core keep the final admission and scope decision; no renderer grant.
 */
export type FormField = {
  readonly id: 'url';
  readonly kind: 'url';
  readonly label: string;
  readonly placeholder: string;
  readonly help: string;
  readonly required: true;
};
export interface LocalFormDescriptor {
  readonly schemaVersion: 1;
  readonly operation: 'url-preview';
  readonly title: string;
  readonly fields: readonly FormField[];
  readonly requiresCoreConfirmation: true;
  readonly description: string;
}

const URL_PREVIEW_FORM: LocalFormDescriptor = Object.freeze({
  schemaVersion: 1,
  operation: 'url-preview',
  title: '添加下载链接',
  description: '仅构造预览输入；实际目标和权限由 Core 确认。输出目录由 Core 安装配置管理，当前不支持单任务自定义目录。',
  requiresCoreConfirmation: true,
  fields: Object.freeze([
    Object.freeze({
      id: 'url',
      kind: 'url',
      label: '下载链接',
      placeholder: 'https://example.com/file.zip',
      help: '仅支持 http:// 或 https:// 链接；粘贴后先预览再确认。',
      required: true,
    }),
  ]),
});

/** Unsupported operations are absent, not decorative choices users can activate. */
export function getFormDescriptor(operation: string): LocalFormDescriptor | null {
  return operation === 'url-preview' ? URL_PREVIEW_FORM : null;
}

/** Friendly local feedback only — the Core independently revalidates every input. */
export function validatePreviewUrl(raw: string): {
  readonly ok: boolean;
  readonly reason: string | null;
} {
  if (raw.trim() !== raw || raw.length === 0 || raw.length > 8192) {
    return { ok: false, reason: '链接不能为空，也不能包含首尾空格或超过长度限制。' };
  }
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return { ok: false, reason: '请输入不包含账号或密码的 http/https 链接。' };
    }
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: '链接格式无效，请检查是否包含完整的网址。' };
  }
}
