// Web platform globals that every runtime core targets (browsers, workers and Node)
// provides, but that the ES library lacks. Only core's own tsconfig includes this file;
// projects with the DOM library use its full declarations instead.
declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
  readonly protocol: string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare function btoa(data: string): string;
