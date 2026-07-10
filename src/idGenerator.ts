import crypto from "crypto";

// Single implementation for every entity id in the app - was reinvented independently (with the
// exact same Math.random().toString(36) body) in at least 6 different files. Math.random() isn't
// cryptographically secure and only gives ~46 bits of entropy from its base36 slice; randomBytes
// gives real 64 bits of cryptographic randomness for the same call shape.
export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
