import {random} from "remotion";

export function randomInt(seed: number | string, min: number, max: number): number {
  return Math.floor(random(seed) * (max - min + 1) + min);
}

export function anyElement<T>(seed: number | string, array: T[]): T {
  return array[randomInt(seed, 0, array.length - 1)];
}
