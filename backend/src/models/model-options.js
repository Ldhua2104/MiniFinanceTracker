export const timestamps = { createdAt: true, updatedAt: true };
export const schemaOptions = {
  timestamps,
  autoIndex: false,
  versionKey: false,
  strict: 'throw',
  toJSON: {
    transform(_document, value) {
      if (value.id === undefined) value.id = value._id.toString();
      delete value._id;
      delete value.__v;
      return value;
    }
  }
};
