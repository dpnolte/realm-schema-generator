/**
 * @realm Schema
 */
interface Phase {
  name: string;
  phaseId: number;
  articles: Article[];
  optionalFieldsWork?: boolean;
}

interface Article {
  articleId: number;
  title: string;
  /**
   * @realm_index
   *
   */
  url: string;
  content: string;
  type: ArticleType;
  position: ArticlePosition;
  compoundType: CompoundType;
}

enum ArticleType {
  A,
  B,
  C
}

type ArticlePosition = "left" | "center" | "right";

interface SubTypeA {
  a: string;
}

interface SubTypeB {
  b: string;
}

type CompoundType = SubTypeA | SubTypeB;
