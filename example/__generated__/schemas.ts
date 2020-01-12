// Auto-generated, do not edit
import { ObjectSchema } from 'realm';

// schema based on interface from example/models.ts
export const CompoundTypeSchema: ObjectSchema = {
  name: 'CompoundType',
  properties: {
    a: {
      type: 'string',
      optional: true,
    },
    b: {
      type: 'string',
      optional: true,
    },
  },
};

// schema based on interface from example/models.ts
export const ArticleSchema: ObjectSchema = {
  name: 'Article',
  primaryKey: 'articleId',
  properties: {
    articleId: {
      type: 'int',
    },
    title: {
      type: 'string',
    },
    url: {
      type: 'string',
      indexed: true,
    },
    content: {
      type: 'string',
    },
    type: {
      type: 'int',
    },
    position: {
      type: 'string',
    },
    compoundType: {
      type: 'CompoundType',
    },
  },
};

// schema based on interface from example/models.ts
export const PhaseSchema: ObjectSchema = {
  name: 'Phase',
  primaryKey: 'phaseId',
  properties: {
    name: {
      type: 'string',
    },
    phaseId: {
      type: 'int',
    },
    articles: {
      type: 'list',
      objectType: 'Article',
    },
    optionalFieldsWork: {
      type: 'bool',
      optional: true,
    },
  },
};

export const Schemas = [
  CompoundTypeSchema,
  ArticleSchema,
  PhaseSchema,
];
