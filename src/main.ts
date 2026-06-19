import { defaults } from './settings.ts';
import { sample } from './sample.ts';

const input = document.querySelector<HTMLInputElement>('#image')!;

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  const bitmap = await createImageBitmap(file);
  const cells = sample(bitmap, defaults);
  bitmap.close();

  console.log(`sampled ${cells.length} cells (cols=${defaults.cols})`, cells[0]);
});
