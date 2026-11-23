/**
 * Tiny Stack Virtual Machine (make.fun: tiny-stack-vm-01)
 *
 * Implements a high-performance interpreter for the 32-bit Tiny Stack ISA:
 * - 256-word data stack, 64-word call stack, 256-word memory
 * - 1,000,000 step execution limit, 65,536-byte output buffer
 * - Traps: 2=UNDERFLOW, 3=OVERFLOW, 4=DIV_ZERO, 5=BAD_OPCODE, 6=MEMORY,
 *          7=CALL_DEPTH, 8=RET_EMPTY, 9=PC, 10=STEPS, 11=OUTPUT
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface VMResult {
  readonly stdout: Uint8Array;
  readonly exitCode: number;
}

function runVM(prog: Uint8Array, input: Uint8Array): VMResult {
  const stack = new Int32Array(256), memory = new Int32Array(256), callStack = new Int32Array(64), output = new Uint8Array(65536);
  let sp = 0, csp = 0, pc = 0, inPtr = 0, outLen = 0, steps = 0, exitCode = 0;
  const pLen = prog.length;

  vmLoop: while (true) {
    if (steps >= 1000000) { exitCode = 10; break; }
    if (pc < 0 || pc >= pLen) { exitCode = 9; break; }

    const op = prog[pc];
    switch (op) {
      case 0x00: exitCode = 0; break vmLoop; // HALT
      case 0x01: // PUSH8
        if (pc + 2 > pLen) { exitCode = 9; break vmLoop; }
        if (sp >= 256) { exitCode = 3; break vmLoop; }
        stack[sp++] = (prog[pc + 1] << 24) >> 24;
        pc += 2;
        break;
      case 0x02: // PUSH32
        if (pc + 5 > pLen) { exitCode = 9; break vmLoop; }
        if (sp >= 256) { exitCode = 3; break vmLoop; }
        stack[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
        pc += 5;
        break;
      case 0x03: // POP
        if (sp < 1) { exitCode = 2; break vmLoop; }
        sp--; pc++; break;
      case 0x04: // DUP
        if (sp < 1) { exitCode = 2; break vmLoop; }
        if (sp >= 256) { exitCode = 3; break vmLoop; }
        stack[sp] = stack[sp - 1]; sp++; pc++; break;
      case 0x05: { // SWAP
        if (sp < 2) { exitCode = 2; break vmLoop; }
        const t = stack[sp - 1]; stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t;
        pc++; break;
      }
      case 0x06: // OVER
        if (sp < 2) { exitCode = 2; break vmLoop; }
        if (sp >= 256) { exitCode = 3; break vmLoop; }
        stack[sp] = stack[sp - 2]; sp++; pc++; break;
      case 0x07: { // ROT
        if (sp < 3) { exitCode = 2; break vmLoop; }
        const c = stack[sp - 1], b = stack[sp - 2], a = stack[sp - 3];
        stack[sp - 3] = b; stack[sp - 2] = c; stack[sp - 1] = a;
        pc++; break;
      }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (sp < 2) { exitCode = 2; break vmLoop; }
        const b = stack[--sp], a = stack[--sp];
        if (b === 0 && (op === 0x13 || op === 0x14 || op === 0x15 || op === 0x16)) { exitCode = 4; break vmLoop; }
        let res = 0;
        if (op === 0x10) res = (a + b) | 0;
        else if (op === 0x11) res = (a - b) | 0;
        else if (op === 0x12) res = Math.imul(a, b);
        else if (op === 0x13) res = (a === -2147483648 && b === -1) ? a : ((a / b) | 0);
        else if (op === 0x14) res = b === -1 ? 0 : ((a % b) | 0);
        else if (op === 0x15) res = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        else if (op === 0x16) res = ((a >>> 0) % (b >>> 0)) | 0;
        else if (op === 0x18) res = a & b;
        else if (op === 0x19) res = a | b;
        else if (op === 0x1a) res = a ^ b;
        else if (op === 0x1c) res = a << (b & 31);
        else if (op === 0x1d) res = a >> (b & 31);
        else if (op === 0x1e) res = (a >>> (b & 31)) | 0;
        else if (op === 0x20) res = a === b ? 1 : 0;
        else if (op === 0x21) res = a < b ? 1 : 0;
        else if (op === 0x22) res = (a >>> 0) < (b >>> 0) ? 1 : 0;
        stack[sp++] = res; pc++; break;
      }
      case 0x17: case 0x1b: // NEG, NOT
        if (sp < 1) { exitCode = 2; break vmLoop; }
        stack[sp - 1] = op === 0x17 ? (-stack[sp - 1]) | 0 : ~stack[sp - 1];
        pc++; break;
      case 0x30: case 0x31: case 0x32: { // JMP, JZ, JNZ
        if (pc + 3 > pLen) { exitCode = 9; break vmLoop; }
        const rel = ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16) >> 16;
        if (op === 0x30) { pc += 3 + rel; break; }
        if (sp < 1) { exitCode = 2; break vmLoop; }
        const v = stack[--sp];
        pc = ((op === 0x31 && v === 0) || (op === 0x32 && v !== 0)) ? pc + 3 + rel : pc + 3;
        break;
      }
      case 0x33: // CALL
        if (pc + 3 > pLen) { exitCode = 9; break vmLoop; }
        if (csp >= 64) { exitCode = 7; break vmLoop; }
        callStack[csp++] = pc + 3;
        pc = prog[pc + 1] | (prog[pc + 2] << 8);
        break;
      case 0x34: // RET
        if (csp === 0) { exitCode = 8; break vmLoop; }
        pc = callStack[--csp];
        break;
      case 0x40: { // LOAD
        if (sp < 1) { exitCode = 2; break vmLoop; }
        const addr = stack[--sp];
        if (addr < 0 || addr >= 256) { exitCode = 6; break vmLoop; }
        stack[sp++] = memory[addr];
        pc++; break;
      }
      case 0x41: { // STORE
        if (sp < 2) { exitCode = 2; break vmLoop; }
        const addr = stack[--sp], val = stack[--sp];
        if (addr < 0 || addr >= 256) { exitCode = 6; break vmLoop; }
        memory[addr] = val;
        pc++; break;
      }
      case 0x50: { // PRINT
        if (sp < 1) { exitCode = 2; break vmLoop; }
        const s = String(stack[--sp]);
        if (outLen + s.length > 65536) { exitCode = 11; break vmLoop; }
        for (let i = 0; i < s.length; i++) output[outLen++] = s.charCodeAt(i);
        pc++; break;
      }
      case 0x51: // PUTC
        if (sp < 1) { exitCode = 2; break vmLoop; }
        if (outLen + 1 > 65536) { exitCode = 11; break vmLoop; }
        output[outLen++] = stack[--sp] & 255;
        pc++; break;
      case 0x52: // IN
        if (sp >= 256) { exitCode = 3; break vmLoop; }
        stack[sp++] = inPtr < input.length ? input[inPtr++] : -1;
        pc++; break;
      case 0x53: // EXIT
        if (sp < 1) { exitCode = 2; break vmLoop; }
        exitCode = stack[--sp] & 255;
        break vmLoop;
      default: // BAD_OPCODE
        exitCode = 5;
        break vmLoop;
    }
    steps++;
  }
  return { stdout: output.subarray(0, outLen), exitCode };
}

function main(): void {
  const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  for (const id of readdirSync(inDir).sort()) {
    const prog = readFileSync(join(inDir, id, 'program.bin'));
    const input = readFileSync(join(inDir, id, 'input.bin'));
    const { stdout, exitCode } = runVM(prog, input);

    const targetDir = join(outDir, id);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'stdout.bin'), stdout);
    writeFileSync(join(targetDir, 'exit.txt'), `${exitCode}\n`);
  }
}

main();
