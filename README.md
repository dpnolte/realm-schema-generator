# realm-schema-generator

## install packages
```
yarn add -D realm-ts-schema-generator typescript ts-node
yarn add realm
```

## create schema generator script
add a script file, for example 'scripts/generateSchemas.ts':
```
import path from 'path';
import { generator } from 'realm-ts-schema-generator';

generator(
    [path.join(__dirname, '../src/store/models.ts')],
    path.join(__dirname, '../realm/__generated__/schemas.ts'),
    path.join(__dirname, '../tsconfig.json')
);
```

# run with ts-node
```
yarn ts-node -T scripts/generateSchemas.ts
```
