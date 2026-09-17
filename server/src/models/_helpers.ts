import { Schema } from 'mongoose';

/** Consistent JSON output: `id` alongside `_id`, and no internal version key. */
export function applyJsonTransform(schema: Schema, hidden: string[] = []) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      for (const key of hidden) delete ret[key];
      return ret;
    },
  });
}

/** Append-only status trail embedded in workflow documents. */
export function statusHistorySchema() {
  return new Schema(
    {
      status: { type: String, required: true },
      at: { type: Date, default: Date.now },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      note: { type: String },
    },
    { _id: false },
  );
}
