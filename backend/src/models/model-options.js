export const timestamps = { createdAt: true, updatedAt: true };
export const schemaOptions = {
  timestamps,
  versionKey: false,
  strict: 'throw',
  toJSON: {
    transform(_document, value) {
      value.id = value._id.toString();
      delete value._id;
      delete value.__v;
      return value;
    }
  }
};
