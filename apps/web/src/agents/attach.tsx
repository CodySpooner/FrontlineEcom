import { useRef } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import type { AttachmentUpload, RunAttachment } from '@frontline/shared';
import { base64 } from '../knowledge/Research';

// A message's documents (decision 11): picked here, read by the server, kept on the run as text. Images come later.

const chip = 'inline-flex h-6 items-center gap-1.5 rounded-md border border-[#1d1d22] bg-[#111114] px-2 text-[11.5px] whitespace-nowrap text-text-2';
const MAX = 10 * 1_048_576;

export const fileSize = (n: number) => (n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

/** Why the files can't be sent, if they can't. The server checks this too, and reads each one. */
export const attachError = (files: File[]) => (files.reduce((n, f) => n + f.size, 0) > MAX ? 'Attachments are up to 10 MB in total per message.' : undefined);

export const toUploads = (files: File[]): Promise<AttachmentUpload[]> => Promise.all(files.map(async (f) => ({ name: f.name, data: await base64(f) })));

export function AttachButton({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach documents"
        title="Attach documents: PDF, TXT, MD, CSV or HTML, up to 10 MB in all. Images aren't supported yet."
        onClick={() => input.current?.click()}
        className="grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-[#16161a] hover:text-white"
      >
        <Paperclip className="size-4" />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".pdf,.txt,.md,.csv,.html"
        aria-label="Documents to attach"
        onChange={(e) => {
          onChange([...files, ...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Picked files (`onChange` removes one), or a sent message's documents. */
export function Attachments({ files, onChange }: { files: (File | RunAttachment)[]; onChange?: (files: File[]) => void }) {
  if (!files.length) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <li key={i} className={chip}>
          <FileText aria-hidden className="size-3.5 shrink-0" />
          <span className="max-w-[200px] truncate">{f.name}</span>
          <span className="text-muted">
            {fileSize(f.size)}
            {'cut' in f && f.cut && ` · only its first ${f.text.length.toLocaleString('en')} characters were read`}
          </span>
          {onChange && (
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange((files as File[]).filter((_, j) => j !== i))} className="cursor-pointer text-muted hover:text-white">
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
