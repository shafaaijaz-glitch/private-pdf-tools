// The order here is the order of the tabs.
import { organize } from './organize.js';
import { split } from './split.js';
import { compress } from './compress.js';
import { sign } from './sign.js';
import { numbers, watermark } from './stamp.js';
import { toImages } from './toimages.js';
import { metadata } from './metadata.js';

export const tools = [organize, split, compress, sign, numbers, watermark, toImages, metadata];
