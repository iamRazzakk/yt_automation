/** Prisma BigInt fields (e.g. Clip.sizeBytes, JobEvent.id) break Fastify's JSON.stringify. */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (!proto.toJSON) {
    proto.toJSON = function toJSON(this: bigint) {
      return this.toString();
    };
  }
}
