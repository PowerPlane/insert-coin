/**
 * Intel HEX in, a flash image out.
 *
 * The file PlatformIO leaves at `.pio/build/<env>/firmware.hex` is what
 * gets dropped on the page. avr-objcopy writes flash addresses from 0
 * (the chip maps flash at 0x8000 for UPDI, `target.flash.base` adds that
 * later), one data record per 16 bytes, an end-of-file record last.
 *
 * ══ WHAT IS REJECTED, AND WHY ══
 * Anything that cannot be a flash image for this chip fails here, before
 * a wire is touched: a corrupt line, a bad checksum, data past the end of
 * flash, two records that disagree about a byte. An `.eep` or a hex built
 * with an EEPROM section carries addresses at 0x810000, which lands in
 * "past the end of flash" and is reported as such.
 *
 * Gaps between records are filled with 0xFF, the erased state, so writing
 * the image writes exactly what the file describes and nothing older.
 */

export interface HexImage {
  /** `flashSize` bytes, 0xFF where the file said nothing. */
  readonly image: Uint8Array;
  /** One past the highest address the file wrote. 0 for an empty file. */
  readonly used: number;
  /** Data records seen. */
  readonly records: number;
}

export class HexError extends Error {
  constructor(
    message: string,
    /** 1-based line in the file, when a specific line is at fault. */
    readonly line?: number,
  ) {
    super(message);
    this.name = "HexError";
  }
}

function hexByte(text: string, at: number, line: number): number {
  const pair = text.substring(at, at + 2);
  if (!/^[0-9A-Fa-f]{2}$/.test(pair)) {
    throw new HexError(`Line ${line} is not hex: "${pair}"`, line);
  }
  return parseInt(pair, 16);
}

/**
 * Parse an Intel HEX file into a flash image of `flashSize` bytes.
 *
 * Record types: 00 data, 01 end of file, 02 extended segment address,
 * 04 extended linear address. 03 and 05 (start addresses) are ignored, as
 * avrdude ignores them.
 */
export function parseIntelHex(text: string, flashSize: number): HexImage {
  const image = new Uint8Array(flashSize).fill(0xff);
  const written = new Uint8Array(flashSize); // 1 where a record has written
  let used = 0;
  let records = 0;
  let upper = 0; // contribution of type 02/04 records to the address
  let ended = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    const n = i + 1;
    if (line === "") continue;
    if (ended) throw new HexError(`Line ${n} comes after the end-of-file record`, n);
    if (!line.startsWith(":")) throw new HexError(`Line ${n} does not start with ":"`, n);

    const body = line.substring(1);
    if (body.length < 10 || body.length % 2 !== 0) {
      throw new HexError(`Line ${n} is too short to be a record`, n);
    }
    const count = hexByte(body, 0, n);
    if (body.length !== (5 + count) * 2) {
      throw new HexError(`Line ${n} says ${count} bytes but carries ${(body.length - 10) / 2}`, n);
    }

    let sum = 0;
    for (let at = 0; at < body.length; at += 2) sum += hexByte(body, at, n);
    if ((sum & 0xff) !== 0) {
      throw new HexError(`Line ${n} fails its checksum. The file was damaged in transit.`, n);
    }

    const address = (hexByte(body, 2, n) << 8) | hexByte(body, 4, n);
    const type = hexByte(body, 6, n);

    switch (type) {
      case 0x00: {
        records++;
        const start = upper + address;
        for (let k = 0; k < count; k++) {
          const addr = start + k;
          if (addr >= flashSize) {
            throw new HexError(
              `Line ${n} writes address 0x${addr.toString(16)}, past the end of flash ` +
                `(${flashSize} bytes). Is this a flash image for this chip?`,
              n,
            );
          }
          const byte = hexByte(body, 8 + k * 2, n);
          if (written[addr] && image[addr] !== byte) {
            throw new HexError(`Line ${n} rewrites address 0x${addr.toString(16)} with a different value`, n);
          }
          image[addr] = byte;
          written[addr] = 1;
          if (addr + 1 > used) used = addr + 1;
        }
        break;
      }
      case 0x01:
        ended = true;
        break;
      case 0x02:
        upper = ((hexByte(body, 8, n) << 8) | hexByte(body, 10, n)) * 0x10;
        break;
      case 0x04:
        // Multiplied, not shifted: `<< 16` of 0x8000 and up goes negative in
        // JavaScript, and a negative index into a typed array is a silent no-op.
        upper = ((hexByte(body, 8, n) << 8) | hexByte(body, 10, n)) * 0x10000;
        break;
      case 0x03:
      case 0x05:
        break;
      default:
        throw new HexError(`Line ${n} has an unknown record type ${type}`, n);
    }
  }

  if (!ended) throw new HexError("No end-of-file record. The file is cut short.");
  if (records === 0) throw new HexError("The file has no data in it.");
  return { image, used, records };
}
