// Small radix-2 FFT. Window sizes in RollMap are tiny (64 samples), so clarity beats speed.

export interface Complex {
  re: Float64Array;
  im: Float64Array;
}

export function fft(re: Float64Array, im: Float64Array, inverse = false): Complex {
  const n = re.length;
  if (n & (n - 1)) throw new Error(`FFT size must be a power of two, got ${n}`);
  const outRe = Float64Array.from(re);
  const outIm = Float64Array.from(im);

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [outRe[i], outRe[j]] = [outRe[j], outRe[i]];
      [outIm[i], outIm[j]] = [outIm[j], outIm[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = outRe[i + k];
        const aIm = outIm[i + k];
        const bRe = outRe[i + k + len / 2] * curRe - outIm[i + k + len / 2] * curIm;
        const bIm = outRe[i + k + len / 2] * curIm + outIm[i + k + len / 2] * curRe;
        outRe[i + k] = aRe + bRe;
        outIm[i + k] = aIm + bIm;
        outRe[i + k + len / 2] = aRe - bRe;
        outIm[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      outRe[i] /= n;
      outIm[i] /= n;
    }
  }
  return { re: outRe, im: outIm };
}
