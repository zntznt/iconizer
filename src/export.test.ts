import assert from 'node:assert/strict';
import { svgBlob } from './export.ts';

const svg = '<svg width="48" height="32"><rect/></svg>';
const blob = svgBlob(svg);

assert.equal(blob.type, 'image/svg+xml', `type, got ${blob.type}`);

const text = await blob.text();
assert.equal(text, svg, 'blob text must round-trip the input svg string');

console.log('export.test.ts: ok (svg blob type + round-trip)');
