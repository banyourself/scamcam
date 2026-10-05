const base = 36;
const tMin = 1;
const tMax = 26;
const skew = 38;
const damp = 700;
const initialBias = 72;
const initialN = 128;
const maxInt = 0x7fffffff;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let scaled = firstTime ? Math.floor(delta / damp) : delta >> 1;
  scaled += Math.floor(scaled / numPoints);
  let k = 0;
  while (scaled > ((base - tMin) * tMax) >> 1) {
    scaled = Math.floor(scaled / (base - tMin));
    k += base;
  }
  return k + Math.floor(((base - tMin + 1) * scaled) / (scaled + skew));
}

function digitValue(code: number): number {
  if (code >= 48 && code < 58) {
    return code - 22;
  }
  if (code >= 65 && code < 91) {
    return code - 65;
  }
  if (code >= 97 && code < 123) {
    return code - 97;
  }
  return base;
}

export function decodePunycodeLabel(input: string): string | null {
  const output: number[] = [];
  const delimiter = input.lastIndexOf("-");
  const basicLength = delimiter < 0 ? 0 : delimiter;
  for (let index = 0; index < basicLength; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0x80) {
      return null;
    }
    output.push(code);
  }
  let n = initialN;
  let bias = initialBias;
  let i = 0;
  for (let index = basicLength > 0 ? basicLength + 1 : 0; index < input.length; ) {
    const oldI = i;
    let weight = 1;
    for (let k = base; ; k += base) {
      if (index >= input.length) {
        return null;
      }
      const digit = digitValue(input.charCodeAt(index));
      index += 1;
      if (digit >= base || digit > Math.floor((maxInt - i) / weight)) {
        return null;
      }
      i += digit * weight;
      const threshold = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < threshold) {
        break;
      }
      if (weight > Math.floor(maxInt / (base - threshold))) {
        return null;
      }
      weight *= base - threshold;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    if (Math.floor(i / length) > maxInt - n) {
      return null;
    }
    n += Math.floor(i / length);
    i %= length;
    output.splice(i, 0, n);
    i += 1;
  }
  try {
    return String.fromCodePoint(...output);
  } catch {
    return null;
  }
}

export function hostnameToUnicode(hostname: string): string {
  return hostname
    .split(".")
    .map((label) => (label.toLowerCase().startsWith("xn--") ? (decodePunycodeLabel(label.slice(4)) ?? label) : label))
    .join(".");
}
