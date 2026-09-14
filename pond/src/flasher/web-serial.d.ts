/**
 * The slice of the Web Serial API this flasher uses.
 *
 * TypeScript's DOM library does not ship Web Serial (it is a Chromium-only
 * API with no W3C recommendation), and the pond keeps its dependency list
 * short, so the types are declared here rather than pulled from
 * `@types/w3c-web-serial`. Only the members the flasher touches are
 * declared; add to this file rather than reaching for `any`.
 *
 * Shapes follow the WICG spec: https://wicg.github.io/serial/
 */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialOutputSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
  break?: boolean;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: SerialOutputSignals): Promise<void>;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  /** Present in Chromium browsers only. Feature-detect before use. */
  readonly serial?: Serial;
}
