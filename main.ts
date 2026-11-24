import * as fs from 'node:fs';
import * as path from 'node:path';

const I = new Uint8Array(256);
const T = [0,128,1,145,2,193,3,132,4,134,5,138,6,139,7,143,23,133,27,133,48,160,49,164,50,164,51,160,52,128,64,133,65,136,80,132,81,132,82,129,83,132];
for (let i = 0; i < T.length;) I[T[i++]] = T[i++];
for (let k = 16; k <= 34; k++) if (k !== 23 && k !== 27 && k !== 31) I[k] = 137;

function runVM(code: Uint8Array, input: Uint8Array) {
  const S = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256), O = new Uint8Array(65536);
  let sp = 0, csp = 0, pc = 0, ip = 0, op = 0, steps = 0, exit = 0;
  const n = code.length;

  loop: while (true) {
    if (steps >= 1e6) { exit = 10; break; }
    if (pc < 0 || pc >= n) { exit = 9; break; }
    const m = I[code[pc]];
    if (!m) { exit = 5; break; }
    const imm = (m >> 4) & 7, pops = (m >> 2) & 3, next = pc + 1 + imm;
    if (pc + imm >= n) { exit = 9; break; }
    steps++;
    if (sp < pops) { exit = 2; break; }
    if (sp - pops + (m & 3) > 256) { exit = 3; break; }
    const c = code[pc];
    pc = next;

    if (c >= 16 && c <= 34 && c !== 23 && c !== 27) {
      const b = S[--sp], a = S[--sp], u = b >>> 0, v = a >>> 0, s = b & 31;
      if (!b && c >= 19 && c <= 22) { exit = 4; break; }
      S[sp++] = c === 16 ? a + b | 0 : c === 17 ? a - b | 0 : c === 18 ? Math.imul(a, b) :
        c === 19 ? (a === -0x80000000 && b === -1 ? a : a / b | 0) :
        c === 20 ? (b === -1 ? 0 : a % b | 0) :
        c === 21 ? Math.floor(v / u) | 0 : c === 22 ? v % u | 0 :
        c === 24 ? a & b : c === 25 ? a | b : c === 26 ? a ^ b :
        c === 28 ? a << s : c === 29 ? a >> s : c === 30 ? a >>> s | 0 :
        c === 32 ? +(a === b) : c === 33 ? +(a < b) : +(v < u);
      continue;
    }

    switch (c) {
      case 0: exit = 0; break loop;
      case 1: S[sp++] = (code[next - 1] << 24) >> 24; break;
      case 2: S[sp++] = code[next - 4] | (code[next - 3] << 8) | (code[next - 2] << 16) | (code[next - 1] << 24); break;
      case 3: sp--; break;
      case 4: S[sp] = S[sp - 1]; sp++; break;
      case 5: [S[sp - 1], S[sp - 2]] = [S[sp - 2], S[sp - 1]]; break;
      case 6: S[sp] = S[sp - 2]; sp++; break;
      case 7: [S[sp - 3], S[sp - 2], S[sp - 1]] = [S[sp - 2], S[sp - 1], S[sp - 3]]; break;
      case 23: S[sp - 1] = -S[sp - 1] | 0; break;
      case 27: S[sp - 1] = ~S[sp - 1]; break;
      case 48: case 49: case 50: {
        const rel = ((code[next - 2] | (code[next - 1] << 8)) << 16) >> 16;
        if (c === 48 || (c === 49 ? !S[--sp] : !!S[--sp])) pc = next + rel;
        break;
      }
      case 51:
        if (csp >= 64) { exit = 7; break loop; }
        C[csp++] = next; pc = code[next - 2] | (code[next - 1] << 8); break;
      case 52:
        if (!csp) { exit = 8; break loop; }
        pc = C[--csp]; break;
      case 64: {
        const a = S[sp - 1];
        if (a >>> 8) { exit = 6; break loop; }
        S[sp - 1] = M[a]; break;
      }
      case 65: {
        const a = S[sp - 1], val = S[sp - 2];
        if (a >>> 8) { exit = 6; break loop; }
        sp -= 2; M[a] = val; break;
      }
      case 80: {
        const s = String(S[--sp]);
        if (op + s.length > 65536) { exit = 11; break loop; }
        for (let i = 0; i < s.length;) O[op++] = s.charCodeAt(i++);
        break;
      }
      case 81:
        if (op >= 65536) { exit = 11; break loop; }
        O[op++] = S[--sp] & 255; break;
      case 82:
        S[sp++] = ip < input.length ? input[ip++] : -1; break;
      case 83:
        exit = S[--sp] & 255; break loop;
    }
  }
  return { stdout: O.subarray(0, op), exitCode: exit };
}

function main(): void {
  const [I, O] = [process.env.MAKEFUN_INPUT_DIR ?? '/input', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'];
  for (const id of fs.readdirSync(I).sort()) {
    const res = runVM(fs.readFileSync(path.join(I, id, 'program.bin')), fs.readFileSync(path.join(I, id, 'input.bin')));
    const d = path.join(O, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'stdout.bin'), res.stdout);
    fs.writeFileSync(path.join(d, 'exit.txt'), `${res.exitCode}\n`);
  }
}

main();
