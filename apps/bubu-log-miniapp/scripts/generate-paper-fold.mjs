import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const progressSteps = 41;
const tiltSteps = 13;
const scale = 1000;

const quantize = (value) => Math.round(value * scale);

function frame(progress, tilt) {
  const slope = tilt * 0.85 * Math.sin(Math.PI * progress);
  const remaining = 1 - progress;
  const intercept = remaining - 0.5 * slope;
  const theta = (120 + 60 * Math.sin(Math.PI * progress / 2)) * Math.PI / 180;

  const flat = [
    [-2, 0],
    [intercept, 0],
    [intercept + slope, 1],
    [-2, 1],
  ];
  const back = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) => {
    const signed = x - slope * y - intercept;
    const projectionScale = (1 - Math.cos(theta)) * signed / (1 + slope * slope);
    return [x - projectionScale, y + projectionScale * slope];
  });
  const center = [
    back.reduce((sum, [x]) => sum + x, 0) / back.length,
    back.reduce((sum, [, y]) => sum + y, 0) / back.length,
  ];
  const shadow = back.map(([x, y]) => [
    center[0] + (x - center[0]) * 1.015 + 0.006,
    center[1] + (y - center[1]) * 1.015 + 0.005,
  ]);

  return [flat, back, shadow].map((polygon) => (
    polygon.map(([x, y]) => [quantize(x), quantize(y)])
  ));
}

const frames = Array.from({ length: tiltSteps }, (_, tiltIndex) => {
  const tilt = tiltIndex / (tiltSteps - 1) * 2 - 1;
  return Array.from({ length: progressSteps }, (_, progressIndex) => (
    frame(progressIndex / (progressSteps - 1), tilt)
  ));
}).flat();

const table = { version: 2, progressSteps, tiltSteps, frames };
const output = process.argv.length > 2
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "../src/gestures/paper-fold-frames.json");

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(table)}\n`);
}
