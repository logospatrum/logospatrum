import { describe, it, expect } from "vitest";
import type { Root, Paragraph } from "mdast";
import { remarkCitation } from "../remark-citation";

function transform(tree: Root): Root {
  // unified plugins return a transformer function; call it directly.
  const transformer = (remarkCitation as unknown as () => (t: Root) => void)();
  transformer(tree);
  return tree;
}

function paragraphTree(text: string): Root {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: text }],
      } as Paragraph,
    ],
  };
}

describe("remarkCitation", () => {
  it("replaces single marker with citationMarker node", () => {
    const t = paragraphTree("hello [[#1|a/b/0001/p1|«q»]] world");
    transform(t);
    const para = t.children[0] as Paragraph;
    expect(para.children).toEqual([
      { type: "text", value: "hello " },
      {
        type: "citationMarker",
        data: {
          hName: "citation-marker",
          hProperties: { n: "1", slug: "a/b/0001/p1", quote: "q" },
        },
      },
      { type: "text", value: " world" },
    ]);
  });

  it("handles multiple markers with N from the literal", () => {
    const t = paragraphTree(
      "a [[#1|s1/w1/0001/p1|«q1»]] b [[#2|s2/w2/0002/p2|«q2»]] c",
    );
    transform(t);
    const para = t.children[0] as Paragraph;
    expect(para.children).toHaveLength(5);
    type CM = { data: { hProperties: { n: string } } };
    expect((para.children[1] as unknown as CM).data.hProperties.n).toBe("1");
    expect((para.children[3] as unknown as CM).data.hProperties.n).toBe("2");
  });

  it("does not match the agent form (must be pre-numbered)", () => {
    const t = paragraphTree("a [[s1/w1/0001/p1|«q1»]] b");
    transform(t);
    const para = t.children[0] as Paragraph;
    expect(para.children).toEqual([
      { type: "text", value: "a [[s1/w1/0001/p1|«q1»]] b" },
    ]);
  });

  it("does not descend into code blocks (no children)", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: null,
          meta: null,
          value: "[[#1|x/y/0001/p1|«q»]]",
        } as unknown as Root["children"][number],
      ],
    };
    transform(tree);
    type CodeNode = { value: string };
    expect((tree.children[0] as unknown as CodeNode).value).toBe(
      "[[#1|x/y/0001/p1|«q»]]",
    );
  });

  it("walks into nested children (e.g., emphasis)", () => {
    const t: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "emphasis",
              children: [
                { type: "text", value: "look [[#1|a/b/0001/p1|«q»]] here" },
              ],
            } as unknown as Paragraph["children"][number],
          ],
        } as Paragraph,
      ],
    };
    transform(t);
    type EmNode = { children: Array<{ type: string }> };
    const em = (t.children[0] as Paragraph).children[0] as unknown as EmNode;
    expect(em.children).toHaveLength(3);
    expect(em.children[1].type).toBe("citationMarker");
  });
});
