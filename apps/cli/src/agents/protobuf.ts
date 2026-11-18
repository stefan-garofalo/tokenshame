import * as Option from "effect/Option";

// A small protobuf wire reader for `antigravity.ts`. It knows varints and length-delimited
// fields, the only wire types a token count or a nested message uses, and it keeps no schema.
// Fixed-width fields are stepped over. Bytes that do not follow the format (a truncated
// field, a group, an overlong varint) make the whole message `none`; nothing throws.

/** A numeric field. Values past the safe integer range are clamped, never wrapped or thrown. */
interface VarintField {
  readonly _tag: "Varint";
  readonly number: number;
  readonly value: number;
}

/** A length-delimited field: a nested message, a packed list, or text. A view, not a copy. */
interface BytesField {
  readonly _tag: "Bytes";
  readonly number: number;
  readonly value: Uint8Array;
}

export type Field = VarintField | BytesField;
export type Message = readonly Field[];

const wireVarint = 0;
const wireFixed64 = 1;
const wireBytes = 2;
const wireFixed32 = 5;
const maxVarintBytes = 10;
const continuation = 0x80;

interface Read<A> {
  readonly value: A;
  readonly next: number;
}

/** Reads a varint at `offset`; none when it is truncated or longer than 10 bytes. */
const readVarint = (bytes: Uint8Array, offset: number): Option.Option<Read<number>> => {
  let value = 0;
  for (let index = 0; index < maxVarintBytes; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) {
      return Option.none();
    }
    // Multiplication, not shifts: a 32-bit shift would wrap values past 2^31.
    value += (byte % continuation) * 2 ** (7 * index);
    if (byte < continuation) {
      return Option.some({
        next: offset + index + 1,
        value: Math.min(value, Number.MAX_SAFE_INTEGER),
      });
    }
  }
  return Option.none();
};

/** Byte width of a fixed-width wire type, or 0 for a wire type this reader does not step over. */
const fixedWidth = (wire: number): number => {
  if (wire === wireFixed64) {
    return 8;
  }
  return wire === wireFixed32 ? 4 : 0;
};

const readField = (bytes: Uint8Array, offset: number): Option.Option<Read<Option.Option<Field>>> =>
  Option.flatMap(readVarint(bytes, offset), (key) => {
    const number = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (number === 0) {
      return Option.none();
    }
    if (wire === wireVarint) {
      return Option.map(readVarint(bytes, key.next), (read) => ({
        next: read.next,
        value: Option.some<Field>({ _tag: "Varint", number, value: read.value }),
      }));
    }
    if (wire === wireBytes) {
      return Option.flatMap(readVarint(bytes, key.next), (length) =>
        length.next + length.value > bytes.length
          ? Option.none()
          : Option.some({
              next: length.next + length.value,
              value: Option.some<Field>({
                _tag: "Bytes",
                number,
                value: bytes.subarray(length.next, length.next + length.value),
              }),
            }),
      );
    }
    const width = fixedWidth(wire);
    return width > 0 && key.next + width <= bytes.length
      ? Option.some({ next: key.next + width, value: Option.none() })
      : Option.none();
  });

/** Decodes every varint and length-delimited field of a message; none when the bytes are malformed. */
export const decodeMessage = (bytes: Uint8Array): Option.Option<Message> => {
  const fields: Field[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const read = readField(bytes, offset);
    if (Option.isNone(read)) {
      return Option.none();
    }
    if (Option.isSome(read.value.value)) {
      fields.push(read.value.value.value);
    }
    offset = read.value.next;
  }
  return Option.some(fields);
};

/** The first varint field with this number. */
export const varintOf = (message: Message, number: number): Option.Option<number> => {
  const field = message.find(
    (candidate) => candidate.number === number && candidate._tag === "Varint",
  );
  return field?._tag === "Varint" ? Option.some(field.value) : Option.none();
};

/** The first nested message with this number; none when it is absent or malformed. */
export const messageOf = (message: Message, number: number): Option.Option<Message> => {
  const field = message.find(
    (candidate) => candidate.number === number && candidate._tag === "Bytes",
  );
  return field?._tag === "Bytes" ? decodeMessage(field.value) : Option.none();
};

/** The first text field with this number. Invalid UTF-8 becomes replacement characters. */
export const textOf = (message: Message, number: number): Option.Option<string> => {
  const field = message.find(
    (candidate) => candidate.number === number && candidate._tag === "Bytes",
  );
  return field?._tag === "Bytes"
    ? Option.some(new TextDecoder().decode(field.value))
    : Option.none();
};

/** Every number of a repeated varint field, whether written one by one or packed. */
export const varintsOf = (message: Message, number: number): readonly number[] =>
  message.flatMap((field) => {
    if (field.number !== number) {
      return [];
    }
    if (field._tag === "Varint") {
      return [field.value];
    }
    const packed: number[] = [];
    let offset = 0;
    while (offset < field.value.length) {
      const read = readVarint(field.value, offset);
      if (Option.isNone(read)) {
        return [];
      }
      packed.push(read.value.value);
      offset = read.value.next;
    }
    return packed;
  });
