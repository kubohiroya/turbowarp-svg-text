# TurboWarp-SVG-Text

<img src="assets/block-icon.svg" alt="" width="48" height="48">

[English](README.md) | 日本語

TurboWarp-SVG-Textは、応答的な名前付きスタイル、host非依存のplain/rubyレイアウト、SVG text actorを
提供します。`turbowarp-bubble`のようなhost拡張機能に対するテキストproviderであり、Bubbleの形状、配置、
portrait、アニメーションはhost側の責務です。

## 実行できるサンプル

[**TurboWarp Editorでデモを開く**](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-svg-text%2Fsamples%2Fstyle-hello-text.sb3) · [SB3をダウンロード](https://kubohiroya.github.io/turbowarp-svg-text/samples/style-hello-text.sb3)

**Run without sandbox**を選んで**Allow**し、緑の旗を押します。
`defineStyle`・`setText`でスプライトを文字へ変更し、色とサイズを確認。サンプルの元データと期待結果は[`samples/README.md`](samples/README.md)に記載しています。

`pnpm run samples:build`でSB3を再生成し、`pnpm run samples:check`で更新漏れと生成処理を確認します。

## 責務

- フォント、サイズ、色、背景、揃えを持つ再利用可能なテキストスタイルを定義する。
- renderer APIを使わずに、DOM/SVGの利用側向けにhost非依存のplain/rubyの行レイアウトを計算する。
- rendererを使う場合に、SVG text skinを作成・置換・計測・解放する。
- text actorをステージに対して比例させ続ける。
- 名前付きスタイルが変わったときに、表示中のtext actorを再スタイルする。

このpackageは`say`や`think`の吹き出し、吹き出しの尾、actor相対の配置、portrait画像、吹き出しの
アニメーションを提供しません。これらはhost packageとそのcapabilityの責務です。

## インストール

Composition APIはversionを固定して導入します。

```sh
pnpm add --save-exact @kubohiroya/turbowarp-svg-text@0.13.0
```

standaloneのTurboWarp拡張機能は、version固定のjsDelivr URLから利用できます。

```text
https://cdn.jsdelivr.net/npm/@kubohiroya/turbowarp-svg-text@0.13.0/dist/svg-text.js
```

## ブロック

### `define text style [STYLE] background [BACKGROUND] text [TEXT_COLOR] font [FONT] size [SIZE] align [ALIGN]`

名前付きテキストスタイルを定義または置換します。揃えは`left`、`center`、`right`を受け付けます。背景は
SVG text actorの背後の矩形です。host側のBubbleは背景を透明に定義し、独自の外形を描けます。

### `set this sprite text [TEXT] with style [STYLE]`

SVG skinを作成し、現在のスプライトのdrawableへ適用します。改行文字は別の行として描画します。再定義後に
同じスタイル名を使うと、既存のtext actorを描き直します。

## Composition API

composition APIはstandaloneの拡張機能を登録しません。hostがTurboWarpのruntimeと明示的なtargetを
与えます。

```ts
import { createSvgTextComposition } from "@kubohiroya/turbowarp-svg-text/composition";

const svgText = createSvgTextComposition({ runtime: Scratch.vm.runtime });

svgText.defineStyle({
  name: "dialogue-text",
  alignment: "left",
  backgroundColor: "transparent",
  font: "Noto Sans JP",
  fontPercent: 100,
  textColor: "#332200",
});

svgText.setText({
  styleName: "dialogue-text",
  target,
  text: "The End",
});

const width = svgText.measureText({
  styleName: "dialogue-text",
  text: "The End",
});

svgText.releaseTarget(target);
svgText.releaseAll();
```

`setText`はcompositionが所有するSVG skinを作成または置換します。`measureText`は、ステージ相対の
ピクセルで計測した行幅の最大値を返します。`releaseTarget`と`releaseAll`は、compositionが所有する
skinを破棄します。

### host非依存のテキストレイアウト

`createSvgTextLayoutComposition()`は、TurboWarpのruntime、renderer、skin、drawableを必要としません。
`layoutText()`は同期的で、renderer固有のステージサイズを明示的に受け取ります。戻り値は深く凍結された
JSON互換のデータで、全体の`width`/`height`、必要な空白の扱い、正規化された許可済みスタイル値、各行の
テキスト・計測幅・水平位置`x`・ベースライン`baseline`を含みます。

```ts
import { createSvgTextLayoutComposition } from "@kubohiroya/turbowarp-svg-text/composition";

const svgText = createSvgTextLayoutComposition();
svgText.defineStyle({
  name: "dialogue-text",
  alignment: "center",
  backgroundColor: "transparent",
  font: "Noto Sans JP",
  fontPercent: 100,
  textColor: "#332200",
});

const layout = svgText.layoutText({
  styleName: "dialogue-text",
  text: "First line\nSecond line",
  nativeSize: [480, 360],
});

const svgNamespace = "http://www.w3.org/2000/svg";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const textElement = document.createElementNS(svgNamespace, "text");
if (layout.preserveWhitespace) {
  textElement.setAttributeNS(xmlNamespace, "xml:space", "preserve");
}
textElement.setAttribute("fill", layout.style.textColor);
textElement.setAttribute("font-family", layout.style.font);
textElement.setAttribute("font-size", String(layout.style.fontSize));
textElement.setAttribute(
  "text-anchor",
  layout.style.alignment === "center"
    ? "middle"
    : layout.style.alignment === "right"
      ? "end"
      : "start",
);
for (const line of layout.lines) {
  const tspan = document.createElementNS(svgNamespace, "tspan");
  tspan.setAttribute("x", String(line.x));
  tspan.setAttribute("y", String(line.baseline));
  tspan.textContent = line.text;
  textElement.append(tspan);
}
```

hostは上記のように`preserveWhitespace`を適用し、行の内容を`textContent`で設定する必要があります。
このAPIはSVGマークアップ、DOMノード、イベントハンドラ、URL、`foreignObject`を受け取りも返しもしません。
任意の入力テキストは、あくまで行データのまま扱われます。`SvgTextComposition.layoutText()`は、
renderer付きのcompositionでも同じ契約を公開します。どちらの経路も同じレイアウト計算を共有するため、
空白、フォント、計算後のフォントサイズ、揃え、行高、色、padding、角丸、行の配置、幅、高さが
`setText()`と一致します。

### standaloneの名前付きスタイルの受け渡し

標準のTurboWarp拡張機能は、0.8.1から`getLayoutCapability()`を公開します。返される凍結された
capabilityは、`define text style` blockが構築した名前付きスタイルのregistryに対して各要求を解決し、
skinもdrawableも作らずに、同じhost非依存の`layoutText()`のデータを返します。これによりhostは、
DOM/SVGのoverlayでテキストを描くときに、既存プロジェクトのフォント、色、サイズ、揃えなどの
名前付きスタイルの値を保てます。

```ts
const svgTextExtension = Scratch.vm.runtime.ext_kubohiroyasvgtext;
const textLayouts = svgTextExtension.getLayoutCapability();
const layout = textLayouts.layoutText({
  styleName: "dialogue-text",
  text: "Existing named style",
  nativeSize: [480, 360],
});
```

このcapabilityは可変のスタイルmapを公開しません。標準の拡張機能からスタイルを再定義すると以降の
レイアウト結果が変わりますが、すでに返された深く凍結済みのレイアウトデータは変わりません。存在しない
スタイルは標準の拡張機能の既存の挙動に従い、その`default`スタイルで解決されます。

### host非依存のルビテキストレイアウト

`layoutRichText()`は、型付きの`text`と`ruby`のrunを受け取ります。rubyのrunは、親文字と読みを1つの
折り返し・表示単位としてまとめて保ちます。返されるレイアウトは、両方の字列に対する明示的な配置情報と、
決定的な`plainText`および`readingText`の射影を含み、マークアップや実行可能な値を含みません。

```ts
const svgText = createSvgTextLayoutComposition();
svgText.defineStyle({
  name: "dialogue-ruby",
  alignment: "left",
  backgroundColor: "transparent",
  font: "Noto Sans JP",
  fontPercent: 100,
  rubyFontPercent: 50,
  rubyGap: 1,
  textColor: "#332200",
});

const runs = [
  { type: "text", text: "海へ" },
  { type: "ruby", base: "出発", reading: "しゅっぱつ" },
  { type: "text", text: "！" },
] as const;
const layout = svgText.layoutRichText({
  styleName: "dialogue-ruby",
  runs,
  nativeSize: [480, 360],
  maxWidth: 240,
});

const svgNamespace = "http://www.w3.org/2000/svg";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const textElement = document.createElementNS(svgNamespace, "text");
textElement.setAttributeNS(xmlNamespace, "xml:space", "preserve");
textElement.setAttribute("fill", layout.style.textColor);
textElement.setAttribute("font-family", layout.style.font);

const appendGlyph = (glyph: {
  text: string;
  x: number;
  baseline: number;
  fontSize: number;
}) => {
  const tspan = document.createElementNS(svgNamespace, "tspan");
  tspan.setAttribute("x", String(glyph.x));
  tspan.setAttribute("y", String(glyph.baseline));
  tspan.setAttribute("font-size", String(glyph.fontSize));
  tspan.textContent = glyph.text;
  textElement.append(tspan);
};

for (const line of layout.lines) {
  for (const fragment of line.fragments) {
    if (fragment.type === "text") {
      appendGlyph({
        ...fragment,
        fontSize: layout.style.fontSize,
      });
    } else {
      appendGlyph(fragment.reading);
      appendGlyph(fragment.base);
    }
  }
}
```

`maxWidth`はpaddingを含む外側の幅の要求値です。テキストはgrapheme境界で折り返し、rubyのまとまりは
決して分割しません。原子的なrubyのまとまりが1つも収まらない場合、レイアウトはそれを収める大きさまで
広がり、`overflow: true`を報告します。無限ループに陥ったり、黙ってテキストを縮小したりはしません。
`plainText`は各rubyの親文字を保ち、`readingText`はその読みに置き換えます。アクセシビリティや読み上げに
どちらの射影を使うかはhostが選びます。

renderer付きのcompositionでは、`setRichText()`が同じレイアウトからSVG skinを作り、
`measureRichText()`がレイアウト後の内容幅の最大値を返します。既存のplainのメソッドとStandaloneの
blockは変わりません。

`SvgTextComposition`は、hostのCapability adapterに適するよう意図的に設計されています。

```ts
interface TextCapability {
  setText(input: {
    styleName: string;
    target: { drawableID: number };
    text: string;
  }): void;
  measureText(input: { styleName: string; text: string }): number;
  releaseTarget(target: { drawableID: number }): void;
}
```

## TurboWarp Bubbleとの統合

`@kubohiroya/turbowarp-bubble`がBubbleの外形、配置、portraitの層、アニメーションを所有します。Bubbleは
このpackageを`BubbleTextCapability`として使えますが、Bubbleのコア自体がSVG Textに依存することは
ありません。

host非依存のplain契約は`0.6.0`から、型付きruby契約は`0.8.0`から、標準拡張機能の名前付きスタイルの
受け渡しは`0.8.1`から利用できます。[TurboWarp Bubble #59](https://github.com/kubohiroya/turbowarp-bubble/issues/59)は、
既定のoverlayがstandalone拡張機能で定義されたスタイルを使うようになった時点で`0.9.0`に固定すべきです。
[TM Kamishibai #636](https://github.com/kubohiroya/tm-kamishibai/issues/636)、または`layoutRichText()`を
使う他のhostは、peer rangeに`>=0.9.0 <1`を使えます。いずれの下流packageもここからimportしていません。
このpackageが`0.x`の間は、契約の破壊的変更には新しいminor versionが必要です。patchでは後方互換の
capabilityの追加や修正を行います。標準の受け渡しを切り戻すには、独立したlayout compositionを注入するか、
明示的なscratch-render backendを使うversionにBubbleを固定してください。

## 開発

```sh
npm install --global corepack@latest
corepack enable
pnpm install --frozen-lockfile
pnpm run check
```

リリースのsource of truthは`package.json`のversionです。整合性検査は、version固定のREADMEとPagesの
例を揃った状態に保ち、一致しないreleaseタグを拒否します。

SPDX-License-Identifier: MPL-2.0

## 固定入力の編集

任意のGUI capabilityは、起動時フラグ`blockEditorDialogs=1&blockEditorFixedInputs=1`でのみ有効に
なります（既定OFF）。[blockの一覧と編集規則](docs/index.html#fixed-input-editing)を参照してください。
正式なpropertyのSchemaは`schemas/block-editor-fixed-inputs.schema.json`にあり、未変更の生の値と
reporter入力は保持されます。共通エディターは開発・型のための依存で、lockfileではnpm版
`@kubohiroya/turbowarp-extension-data-editor@0.3.4`に固定しています。拡張機能やcomposition APIへ共通の
実行時importを追加することはありません。

明示的なnative Blockly/VMのトランザクション検査は、ビルド後に
`BLOCK_EDITOR_GUI_ROOT=/absolute/path/to/scratch-gui pnpm test:fixed-inputs:native`で実行します。
このコマンドは実際のGUIのvendor依存を必要とし、利用できない場合はskipではなく失敗します。`pnpm test`
および公開済みPagesの検証とは別物です。
