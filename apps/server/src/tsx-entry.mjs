// Runs index.ts through tsx where `--import tsx` can't be passed (Electron's utilityProcess ignores loader flags).
import { register } from 'tsx/esm/api';

register();
await import('./index.ts');
