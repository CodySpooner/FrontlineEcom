import type { PrAdapter } from './adapter';
import { cjAdapter } from './cj';
import { notesSource, ordersSource, feedSource } from './local';
import { trendsApiSource, trendsCsvSource } from './trends';

/** Every Product Research source, in the order the source strip and the health view list them (decision 4). */
export const ADAPTERS: PrAdapter[] = [cjAdapter, trendsCsvSource, trendsApiSource, ordersSource, notesSource, feedSource];
