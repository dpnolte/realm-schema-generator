import path from "path";
import fs from "fs-extra";
import ts from "typescript";
import {
  ObjectSchema,
  PropertiesTypes,
  ObjectSchemaProperty,
  PropertyType
} from "realm";

interface Schemas {
  [schemaName: string]: {
    schema: ObjectSchema;
    relativePath: string;
  };
}
interface CreateProps {
  name: ts.PropertyName;
  isOptional: boolean;
  indexed: boolean;
  isArray?: boolean;
  primaryKeyByDocTag: boolean;
  primaryKey: boolean;
}

interface Context {
  schemas: Schemas;
  checker: ts.TypeChecker;
}

interface SchemaContext {
  primaryKeys: string[];
  derivedPrimaryKeyByDocTag: boolean;
  enforceOptionalProperty: boolean;
  relativePath: string;
}

const isNodeExported = (node: ts.Node): boolean => {
  return (
    (ts.getCombinedModifierFlags(node as ts.Declaration) &&
      ts.ModifierFlags.Export) !== 0 ||
    (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
  );
};

const visitNode = (node: ts.Node, interfaces: ts.InterfaceDeclaration[]) => {
  // Only consider exported nodes
  if (!isNodeExported(node)) {
    return;
  }
  if (ts.isInterfaceDeclaration(node)) {
    if (hasSchemaTag(node)) {
      interfaces.push(node);
    }
  } else if (ts.isModuleDeclaration(node)) {
    console.log("module", node.name);
    // This is a namespace, visit its children
    ts.forEachChild(node, child => visitNode(child, interfaces));
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createEnumWithMarkerToString = <T extends number = number>(
  enumeration: any
) => {
  const map: Map<number, string> = new Map();

  Object.keys(enumeration).forEach(name => {
    const id = enumeration[name];
    if (typeof id === "number" && !map.has(id)) {
      map.set(id, name);
    }
  });
  return (value: T) => map.get(value) as string; // could be undefined if used the wrong enum member..
};
const syntaxKindToString = createEnumWithMarkerToString<ts.SyntaxKind>(
  ts.SyntaxKind
);

const hasSchemaTag = (node: ts.InterfaceDeclaration): boolean => {
  return hasDocTag(node, "realm");
};

const hasDocTag = (node: ts.Node, tagName: string): boolean => {
  const tags = ts.getJSDocTags(node);
  return tags.some(tag => tag.tagName.getText() === tagName);
};

const getRelativePath = (node: ts.Node) =>
  path.relative(process.cwd(), node.getSourceFile().fileName);

const resolveSchemaInterface = (
  node: ts.InterfaceDeclaration,
  context: Context
) => {
  const schemaContext: SchemaContext = {
    primaryKeys: [],
    derivedPrimaryKeyByDocTag: false,
    enforceOptionalProperty: false,
    relativePath: getRelativePath(node)
  };
  const properties = resolveSchemaProperties(node, context, schemaContext);

  createSchema(node.name.getText(), context, schemaContext, properties);
};

const createSchema = (
  name: string,
  context: Context,
  schemaContext: SchemaContext,
  properties: PropertiesTypes
) => {
  const schema: ObjectSchema = {
    name,
    properties,
    primaryKey:
      schemaContext.primaryKeys.length === 1
        ? schemaContext.primaryKeys[0]
        : undefined
  };
  // eslint-disable-next-line no-param-reassign
  context.schemas[schema.name] = {
    schema,
    relativePath: schemaContext.relativePath
  };
};

const createOneSchemaFromMultipleInterfaces = (
  node: ts.DeclarationStatement,
  interfaceDeclarations: ts.InterfaceDeclaration[],
  context: Context
) => {
  const schemaContext: SchemaContext = {
    primaryKeys: [],
    derivedPrimaryKeyByDocTag: false,
    enforceOptionalProperty: true,
    relativePath: getRelativePath(node.getSourceFile())
  };

  let properties = {};
  interfaceDeclarations.forEach(decl => {
    const otherProperties = resolveSchemaProperties(
      decl,
      context,
      schemaContext
    );
    properties = {
      ...properties,
      ...otherProperties
    };
  });
  createSchema(
    node.name?.getText() ?? `Schema${context.schemas.length}`,
    context,
    schemaContext,
    properties
  );
};

const resolveSchemaProperties = (
  node: ts.InterfaceDeclaration,
  context: Context,
  schemaContext: SchemaContext
): PropertiesTypes => {
  let properties: PropertiesTypes = {};
  // check if node is extending from another interface
  if (node.heritageClauses) {
    node.heritageClauses.forEach(heritageClause => {
      heritageClause.types.forEach(herigateTypeExpression => {
        const expressionType = context.checker.getTypeAtLocation(
          herigateTypeExpression.expression
        );
        const expressionSymbol =
          expressionType.symbol ?? expressionType.aliasSymbol;
        const interfaceDeclaration =
          (expressionSymbol?.declarations.find(decl =>
            ts.isInterfaceDeclaration(decl)
          ) as ts.InterfaceDeclaration) || undefined;
        if (interfaceDeclaration) {
          const baseProperties = resolveSchemaProperties(
            interfaceDeclaration,
            context,
            schemaContext
          );
          properties = {
            ...properties,
            ...baseProperties
          };
        }
      });
    });
  }

  node.members.forEach(member => {
    if (ts.isPropertySignature(member) && member.type && member.name) {
      const property = resolveSchemaProperty(
        member,
        member.type,
        member.name,
        context,
        schemaContext
      );
      if (property) {
        properties[property.key] = property.value;
        if (property.primaryKey) {
          if (
            property.primaryKeyByDocTag &&
            !schemaContext.derivedPrimaryKeyByDocTag
          ) {
            // eslint-disable-next-line no-param-reassign
            schemaContext.primaryKeys = [];
            // eslint-disable-next-line no-param-reassign
            schemaContext.derivedPrimaryKeyByDocTag =
              property.primaryKeyByDocTag;
          }
          if (
            property.primaryKeyByDocTag ===
            schemaContext.derivedPrimaryKeyByDocTag
          ) {
            schemaContext.primaryKeys.push(property.key);
          }
        }
      }
    }
  });
  return properties;
};

const resolveSchemaProperty = (
  propertySignature: ts.PropertySignature,
  typeNode: ts.TypeNode,
  name: ts.PropertyName,
  context: Context,
  schemaContext: SchemaContext
): {
  key: string;
  value: PropertyType | ObjectSchemaProperty;
  primaryKey: boolean;
  primaryKeyByDocTag: boolean;
} | null => {
  const isArray = ts.isArrayTypeNode(typeNode);
  const type = ts.isArrayTypeNode(typeNode)
    ? context.checker.getTypeAtLocation(typeNode.elementType)
    : context.checker.getTypeAtLocation(typeNode);

  const isOptional =
    schemaContext.enforceOptionalProperty || !!propertySignature.questionToken;
  const typeAsString = context.checker.typeToString(type);
  const symbol = type.aliasSymbol ?? type.getSymbol();

  const declarations =
    symbol && symbol.declarations ? symbol.declarations : undefined;

  const primaryKeyByDocTag = hasDocTag(propertySignature, "realm_primary_key");
  const primaryKey =
    primaryKeyByDocTag ||
    (!isOptional &&
      name
        .getText()
        .toLowerCase()
        .endsWith("id"));

  const indexed = !primaryKey && hasDocTag(propertySignature, "realm_index");
  const options: CreateProps = {
    name,
    isOptional,
    isArray,
    indexed,
    primaryKey,
    primaryKeyByDocTag
  };

  if (hasDocTag(propertySignature, "realm_date")) {
    return createProperty("date", options);
  }

  if (hasDocTag(propertySignature, "realm_float")) {
    return createProperty("float", options);
  }

  if (hasDocTag(propertySignature, "realm_double")) {
    return createProperty("double", options);
  }

  switch (typeAsString) {
    case "string":
      return createProperty("string", options);
    case "number":
      return createProperty("int", options);
    case "boolean":
      return createProperty("bool", options);
    case "Date":
      return createProperty("date", options);
    default:
      if (!declarations) {
        console.log(
          `> Skipping '${name.getText()}', don't know how to get symbol.`
        );
        return null;
      }
      return resolveDeclaredType(
        name,
        type,
        declarations,
        options,
        context,
        schemaContext
      );
  }
};

const resolveDeclaredType = (
  name: ts.PropertyName,
  type: ts.Type,
  declarations: ts.Declaration[],
  options: CreateProps,
  context: Context,
  schemaContext: SchemaContext
): {
  key: string;
  value: PropertyType | ObjectSchemaProperty;
  primaryKey: boolean;
  primaryKeyByDocTag: boolean;
} | null => {
  const interfaceDeclaration =
    (declarations.find(declaration =>
      ts.isInterfaceDeclaration(declaration)
    ) as ts.InterfaceDeclaration) || undefined;

  if (interfaceDeclaration) {
    const interfaceName = interfaceDeclaration.name.getText(); // resolveInterfaceName(interfaceDeclaration, typeNode);
    resolveSchemaInterface(interfaceDeclaration, context);

    return createProperty(interfaceName, options);
  }

  const enumDeclaration =
    (declarations.find(declaration =>
      ts.isEnumDeclaration(declaration)
    ) as ts.EnumDeclaration) || undefined;

  if (enumDeclaration) {
    const firstEnumMemberType = typeof context.checker.getConstantValue(
      enumDeclaration.members[0]
    );
    if (firstEnumMemberType !== "number" && firstEnumMemberType !== "string") {
      console.log(
        `> Skipping '${name.getText()}', only support number and strint constant value types`
      );
      return null;
    }
    if (
      enumDeclaration.members.some(
        // eslint-disable-next-line valid-typeof
        member =>
          firstEnumMemberType !==
          typeof context.checker.getConstantValue(member)
      )
    ) {
      console.log(
        `> Skipping '${name.getText()}', no support for mixed enum constant value types`
      );
      return null;
    }

    if (firstEnumMemberType === "string") {
      return createProperty("string", options);
    }
    if (firstEnumMemberType === "number") {
      return createProperty("int", options);
    }

    console.log(
      `> Skipping '${name.getText()}', don't know how to handle enum  '${syntaxKindToString(
        enumDeclaration.kind
      )}'`
    );
    return null;
  }

  const enumMemberDeclaration =
    (declarations.find(decl => ts.isEnumMember(decl)) as ts.EnumMember) ||
    undefined;
  if (enumMemberDeclaration) {
    const value = context.checker.getConstantValue(enumMemberDeclaration);
    if (typeof value === "string") {
      return createProperty("string", options);
    }
    if (typeof value === "number") {
      return createProperty("int", options);
    }
    console.log(
      `> Skipping '${name.getText()}', don't know how to handle enum member with value type'${typeof value}'`
    );
    return null;
  }

  const typeAliasDeclaration =
    (declarations.find(declaration =>
      ts.isTypeAliasDeclaration(declaration)
    ) as ts.TypeAliasDeclaration) || undefined;

  if (typeAliasDeclaration) {
    if (type.isIntersection()) {
      console.log(
        `> Skipping '${name.getText()}' as intersection types are not supported (yet).`
      );
      return null;
    }
    if (type.isUnion() && type.types.length > 0) {
      const firstType = type.types[0];
      const isNumber = firstType.isNumberLiteral();
      const isString = firstType.isStringLiteral();
      if (isNumber || isString) {
        if (
          !type.types.every(
            subType =>
              subType.isNumberLiteral() === isNumber &&
              subType.isStringLiteral() === isString
          )
        ) {
          console.log(
            `> Skipping '${name.getText()}', miaxing literal type aliases is not supported`
          );
          return null;
        }
        if (isNumber) {
          return createProperty("int", options);
        }
        if (isString) {
          return createProperty("string", options);
        }
        // for mixed interface types, we combine all the properties of these types in one schema
      } else {
        const interfaceDeclarations: ts.InterfaceDeclaration[] = [];
        type.types.forEach(subType => {
          const decl = subType
            .getSymbol()
            ?.declarations.find(subDecl => ts.isInterfaceDeclaration(subDecl));
          if (decl && ts.isInterfaceDeclaration(decl)) {
            interfaceDeclarations.push(decl);
          }
        });
        // every sub type is an interface
        if (interfaceDeclarations.length === type.types.length) {
          createOneSchemaFromMultipleInterfaces(
            typeAliasDeclaration,
            interfaceDeclarations,
            context
          );
          return createProperty(typeAliasDeclaration.name.getText(), options);
        }
      }
    }
  }

  console.log(
    `> Skipping '${name.getText()}', don't know how to handle kind(s) ${declarations
      .map(decl => syntaxKindToString(decl.kind))
      .join(", ")} with text '${declarations
      .map(decl => decl.getText())
      .join(" or ")}' .`
  );

  return null;
};

const createProperty = (
  value: string,
  {
    name,
    isOptional,
    isArray,
    primaryKey,
    primaryKeyByDocTag,
    indexed: isIndexed
  }: CreateProps
): {
  key: string;
  value: PropertyType | ObjectSchemaProperty;
  primaryKey: boolean;
  primaryKeyByDocTag: boolean;
} => {
  const indexed = isIndexed === true ? true : undefined;
  const optional = isOptional === true ? true : undefined;
  const key = name.getText();

  if (isArray) {
    return {
      key,
      value: {
        type: "list",
        objectType: value,
        optional,
        indexed
      },
      primaryKey,
      primaryKeyByDocTag
    };
  }
  return {
    key,
    value: {
      type: value,
      optional,
      indexed
    },
    primaryKey,
    primaryKeyByDocTag
  };
};

export const generator = (
  rootFilePaths: string[],
  targetPath: string,
  tsConfigPath: string
) => {
  console.log("start");

  fs.ensureDirSync(path.dirname(targetPath));

  console.log("> compiling");

  const { config } = ts.parseConfigFileTextToJson(
    tsConfigPath,
    fs.readFileSync(tsConfigPath).toString()
  );
  const program = ts.createProgram(rootFilePaths, config);
  const checker = program.getTypeChecker();

  const modelFiles = program
    .getSourceFiles()
    .filter(
      sourceFile =>
        !sourceFile.isDeclarationFile &&
        sourceFile.fileName.endsWith("models.ts")
    );

  // console.log(
  //   program
  //     .getSourceFiles()
  //     .filter(sourceFile => !sourceFile.fileName.endsWith(".d.ts"))
  //     .map(sourceFile => sourceFile.fileName)
  //     .join(", ")
  // );

  console.log("> compiled");

  const schemas: {
    [schemaName: string]: {
      schema: ObjectSchema;
      relativePath: string;
    };
  } = {};

  const context: Context = {
    schemas,
    checker
  };

  modelFiles.forEach(sourceFile => {
    const relativePath = path.relative(process.cwd(), sourceFile.fileName);
    console.log(`> processing '${relativePath}'`);
    const interfaces: ts.InterfaceDeclaration[] = [];
    ts.forEachChild(sourceFile, node => visitNode(node, interfaces));

    interfaces.forEach(node => {
      resolveSchemaInterface(node, context);
    });

    console.log(`> finished '${relativePath}'`);
  });

  console.log("> generating realm schemas");
  let content = "// Auto-generated, do not edit\n";
  content += "import { ObjectSchema } from 'realm';\n\n";

  const schemaNames: string[] = [];
  const tab = "  ";
  Object.values(schemas).forEach(item => {
    content += `// schema based on interface from ${item.relativePath}\n`;
    const { schema } = item;
    const schemaName = `${schema.name}Schema`;
    schemaNames.push(schemaName);
    content += `export const ${schemaName}: ObjectSchema = {\n`;
    content += `${tab}name: '${schema.name}',\n`;
    if (schema.primaryKey) {
      content += `${tab}primaryKey: '${schema.primaryKey}',\n`;
    }
    content += `${tab}properties: {\n`;
    Object.entries(schema.properties).forEach(
      ([propertyName, propertyValue]) => {
        if (typeof propertyValue === "string") {
          content += `${tab + tab}${propertyName}: '${propertyValue}',\n`;
        } else {
          content += `${tab + tab}${propertyName}: {\n`;
          Object.keys(propertyValue).forEach(propertyValueKey => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = propertyValue[
              propertyValueKey as keyof ObjectSchemaProperty
            ] as string;
            const valueType = typeof value;
            if (
              valueType === "number" ||
              valueType === "boolean" ||
              valueType === "bigint" ||
              valueType === "object"
            ) {
              content += `${tab + tab + tab}${propertyValueKey}: ${value},\n`;
            } else if (valueType === "string") {
              content += `${tab + tab + tab}${propertyValueKey}: '${value}',\n`;
            } else if (valueType !== "undefined") {
              console.warn(
                `> Skipping property '${propertyValueKey}' of ${schema.name}. Unknown value type-> ${value}`
              );
            }
          });
          content += `${tab + tab}},\n`;
        }
      }
    );
    content += `${tab}},\n`;
    content += "};\n\n";
  });

  content += `export const Schemas = [\n${tab}${schemaNames.join(
    `,\n${tab}`
  )},\n];\n`;

  fs.writeFileSync(targetPath, content);

  console.log("> finished generating schemas");

  console.log("done");
};
