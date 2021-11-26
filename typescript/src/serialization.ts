import type { Quadruple } from "./lib/tuple.ts";
import type { U8 } from "./lib/numbers/mod.ts";
import { u16, u256, u64, u8 } from "./lib/numbers/mod.ts";
import type { List } from "./lib/list.ts";
import * as list from "./lib/list.ts";

import type { BitStr } from "./lib/bit_str.ts";
import * as bit_str from "./lib/bit_str.ts";
import type { Block, BlockBody, Hash, PowSlice, Slice } from "./types/blockchain.ts";
import type { AddressPort, Message } from "./types/networking.ts";
import * as hash from "./types/hash.ts";

import { pad_left } from "./util.ts";

type Nat = bigint;

const HASH = hash.assert;

export function bits_to_uint8array(bits: BitStr): Uint8Array {
  const buff = new Uint8Array(2 + Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i += 8) {
    let numb = 0;
    for (let j = 0; j < 8; ++j) {
      numb *= 2;
      if (bits[i + 8 - j - 1] === "1") {
        numb += 1;
      }
    }
    buff[Math.floor(i / 8)] = numb;
  }
  return buff;
}

export function serialize_bits_to_uint8array(bits: BitStr): Uint8Array {
  if (bits.length >= 2 ** 16) {
    throw `bit string is too large`;
  }
  bits = serialize_bits(bits);
  return bits_to_uint8array(bits);
}

export function deserialize_bits_from_uint8array(buff: Uint8Array): BitStr {
  const size = (buff[0] ?? 0) + (buff[1] ?? 0) * 256;
  let result = bit_str.empty;
  for (let i = 2; i < buff.length; ++i) {
    const val = buff[i] ?? 0;
    for (let j = 0; j < 8 && result.length < size; ++j) {
      const bit = (val >>> j) & 1 ? "1" : "0";
      result = bit_str.push(bit)(result);
    }
  }
  return result;
}

export function serialize_fixed_len(size: number, value: Nat): BitStr {
  if (size > 0) {
    const head = value % 2n === 0n ? "0" : "1";
    const tail = serialize_fixed_len(size - 1, value / 2n); // ?? >> 1n ?
    return bit_str.push_front(head)(tail);
  } else {
    return bit_str.empty;
  }
}

export function deserialize_fixed_len(size: number, bits: BitStr): [BitStr, Nat] {
  if (size === 0) {
    return [bits, 0n];
  } else {
    if (bits[0] === "0") {
      let x;
      [bits, x] = deserialize_fixed_len(size - 1, bit_str.slice(1)(bits));
      return [bits, x * 2n];
    } else if (bits[0] === "1") {
      let x;
      [bits, x] = deserialize_fixed_len(size - 1, bit_str.slice(1)(bits));
      return [bits, x * 2n + 1n];
    } else {
      return [bit_str.empty, 0n];
    }
  }
}

export function serialize_list<T>(item: (x: T) => BitStr, list: List<T>): BitStr {
  switch (list.ctor) {
    case "Nil": {
      const bit0 = "0";
      return bit_str.from(bit0);
    }
    case "Cons": {
      const bit1 = "1";
      const head = item(list.head);
      const tail = serialize_list(item, list.tail);
      const ser = bit_str.concat(head, tail);
      return bit_str.push_front(bit1)(ser);
    }
  }
}

export function deserialize_list<T>(
  item: (x: BitStr) => [BitStr, T],
  bits: BitStr,
): [BitStr, List<T>] {
  if (bits[0] === "0") {
    return [bit_str.slice(1)(bits), list.empty];
  } else if (bits[0] === "1") {
    let head, tail;
    [bits, head] = item(bit_str.slice(1)(bits));
    [bits, tail] = deserialize_list(item, bits);
    return [bits, list.cons(head, tail)];
  }
  return [bit_str.empty, list.empty];
}

export function serialize_hash(hash: Hash): BitStr {
  return serialize_fixed_len(256, BigInt(HASH(hash)));
}

export function deserialize_hash(bits: BitStr): [BitStr, Hash] {
  const [rest, nat] = deserialize_fixed_len(256, bits);
  return [rest, HASH("0x" + pad_left(64, "0", nat.toString(16)))];
}

export function serialize_bits(data: BitStr): BitStr {
  const size = serialize_fixed_len(16, BigInt(data.length));
  return bit_str.concat(size, data);
}

export function deserialize_bits(bits: BitStr): [BitStr, BitStr] {
  let size_: bigint, data: BitStr;
  [bits, size_] = deserialize_fixed_len(16, bits);
  const size = Number(size_);
  [bits, data] = [bit_str.slice(size)(bits), bit_str.slice(0, size)(bits)];
  return [bits, data];
}

export function serialize_uint8array(bytes: number, array: Uint8Array): BitStr {
  let bits = bit_str.empty;
  for (let i = 0; i < bytes; ++i) {
    const ser = serialize_fixed_len(8, BigInt(array[i]));
    bits = bit_str.concat(bits, ser);
  }
  return bits;
}

export function deserialize_uint8array(bytes: number, bits: BitStr): [BitStr, Uint8Array] {
  const vals = [];
  for (let i = 0; i < bytes; ++i) {
    let val: bigint;
    [bits, val] = deserialize_fixed_len(8, bits);
    vals.push(Number(val));
  }
  return [bits, new Uint8Array(vals)];
}

export function serialize_pow_slice(slice: PowSlice): BitStr {
  const work = serialize_fixed_len(64, slice.work);
  const data = serialize_bits(slice.data);
  return bit_str.concat(work, data);
}

export function deserialize_pow_slice(bits: BitStr): [BitStr, PowSlice] {
  let work_: bigint, data: BitStr;
  [bits, work_] = deserialize_fixed_len(64, bits);
  [bits, data] = deserialize_bits(bits);
  const work = u64.mask(work_);
  return [bits, { work, data }];
}

export function serialize_body(body: BlockBody) {
  return serialize_list(serialize_bits, list.from_array(body));
}

export function deserialize_body(bits: BitStr): [BitStr, BlockBody] {
  let slice_list: List<Slice>;
  [bits, slice_list] = deserialize_list(deserialize_bits, bits);
  const slice_arr = list.to_array(slice_list);
  return [bits, slice_arr];
}

export function serialize_block(block: Block): BitStr {
  const prev = serialize_hash(block.prev);
  const time = serialize_fixed_len(256, block.time);
  const body = serialize_body(block.body);
  return bit_str.concat(prev, time, body);
}

export function deserialize_block(bits: BitStr): [BitStr, Block] {
  let prev, time, body;
  [bits, prev] = deserialize_hash(bits);
  [bits, time] = deserialize_fixed_len(256, bits);
  [bits, body] = deserialize_body(bits);
  time = u256.mask(time);
  return [bits, { prev, time, body }];
}

export function serialize_address(address: AddressPort): BitStr {
  switch (address._) {
    case "IPv4": {
      const val0 = serialize_fixed_len(8, BigInt(address.octets[0]));
      const val1 = serialize_fixed_len(8, BigInt(address.octets[1]));
      const val2 = serialize_fixed_len(8, BigInt(address.octets[2]));
      const val3 = serialize_fixed_len(8, BigInt(address.octets[3]));
      const port = serialize_fixed_len(16, BigInt(address.port));
      return bit_str.push_front("0")(bit_str.concat(val0, val1, val2, val3, port));
      // TODO: IPv6
    }
  }
  throw "FAILURE: unknown address type";
}

export function deserialize_address(bits: BitStr): [BitStr, AddressPort] {
  if (bits[0] === "0") {
    let val0, val1, val2, val3, port;
    bits = bit_str.slice(1)(bits);
    [bits, val0] = deserialize_fixed_len(8, bits);
    [bits, val1] = deserialize_fixed_len(8, bits);
    [bits, val2] = deserialize_fixed_len(8, bits);
    [bits, val3] = deserialize_fixed_len(8, bits);
    [bits, port] = deserialize_fixed_len(16, bits);
    const octets = [val0, val1, val2, val3].map(Number).map(u8.mask) as Quadruple<U8>;
    return [bits, { _: "IPv4", octets, port: u16.mask(Number(port)) }];
  }
  // TODO: handle error on bad serialization of messages?
  throw "bad address deserialization";
}

export function serialize_message(message: Message): BitStr {
  switch (message.ctor) {
    case "PutPeers": {
      const code0 = bit_str.from("0000");
      const peers = serialize_list(serialize_address, list.from_array(message.peers));
      return bit_str.concat(code0, peers);
    }
    case "PutBlock": {
      const code1 = bit_str.from("1000");
      const block = serialize_block(message.block);
      return bit_str.concat(code1, block);
    }
    case "AskBlock": {
      const code2 = bit_str.from("0100");
      const b_hash = serialize_hash(message.b_hash);
      return bit_str.concat(code2, b_hash);
    }
    case "PutSlice": {
      const code3 = bit_str.from("1100");
      const slice = serialize_pow_slice(message.slice);
      return bit_str.concat(code3, slice);
    }
  }
}

export function deserialize_message(bits: BitStr): [BitStr, Message] {
  const CODE_SIZE = 4;
  const code = bit_str.slice(0, CODE_SIZE)(bits);
  bits = bit_str.slice(CODE_SIZE)(bits);
  switch (code) {
    case "0000": {
      const [rest, peers] = deserialize_list(deserialize_address, bits);
      return [rest, { ctor: "PutPeers", peers: list.to_array(peers) }];
    }
    case "1000": {
      const [rest, block] = deserialize_block(bits);
      return [rest, { ctor: "PutBlock", block }];
    }
    case "0100": {
      const [rest, b_hash] = deserialize_hash(bits);
      return [rest, { ctor: "AskBlock", b_hash }];
    }
    case "1100": {
      const [rest, slice] = deserialize_pow_slice(bits);
      return [rest, { ctor: "PutSlice", slice }];
    }
  }
  // TODO: handle error on bad serialization of messages?
  throw "bad message deserialization";
}
