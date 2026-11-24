// 金額の式（電卓つきのキーパッド。docs/screens.md 4章）。キーの押下から式の文字列を組み立て、式を評価して、通貨の最小単位の
// 整数にする。画面（RN）には依存しない（`npm test` で守る）。
//
// - 式は、ASCIIの文字列で持つ（`1200+800`、`3000/3`）。演算子は `+ - * /`。画面に出すときだけ `− × ÷` に直す（`formatExpression`）。
// - 計算は、有理数（BigInt）で行い、最後に最小単位へ四捨五入する（`×`・`÷` で最小単位より細かくなったとき。screens.md 4章）。
//   途中で丸めない（`1000÷3×3` は 1000。浮動小数点は使わない。CLAUDE.md の「金額は整数」）。
// - 先頭に演算子は置けない（マイナスの金額は登録できない）。末尾の演算子と `.` は、評価のときに無いものとして扱う。

export type ExpressionKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | '+' | '-' | '*' | '/';

export const OPERATORS = ['+', '-', '*', '/'] as const;
type Operator = (typeof OPERATORS)[number];

/** 式の文字数の上限（桁あふれと、有理数の肥大を防ぐ） */
export const MAX_EXPRESSION_LENGTH = 40;
/** 1つの数の整数部の桁数の上限。1件の上限（10^12。13桁）に合わせる */
export const MAX_INTEGER_DIGITS = 13;
/** 1件の金額の上限（最小単位。Workerの `MAX_AMOUNT_MINOR`。docs/backend-design.md 9章の「共通」） */
export const MAX_AMOUNT_MINOR = 10 ** 12;

function isOperator(char: string | undefined): char is Operator {
  return char !== undefined && (OPERATORS as readonly string[]).includes(char);
}

/** 式の末尾の数（最後の演算子より後ろ） */
function lastOperand(expression: string): string {
  let index = expression.length;
  while (index > 0 && !isOperator(expression[index - 1])) index -= 1;
  return expression.slice(index);
}

function pressDigit(expression: string, digit: string, minorUnit: number): string {
  if (expression.length >= MAX_EXPRESSION_LENGTH) return expression;
  const operand = lastOperand(expression);
  if (operand === '0') {
    // 先頭の 0 は、次の数字で置き換える（`05` にしない）。0 を重ねても変わらない
    return digit === '0' ? expression : `${expression.slice(0, -1)}${digit}`;
  }
  const dot = operand.indexOf('.');
  if (dot >= 0) {
    if (operand.length - dot - 1 >= minorUnit) return expression;
  } else if (operand.length >= MAX_INTEGER_DIGITS) {
    return expression;
  }
  return `${expression}${digit}`;
}

function pressDot(expression: string, minorUnit: number): string {
  // 小数の無い通貨では、`.` を使えない
  if (minorUnit <= 0 || expression.length >= MAX_EXPRESSION_LENGTH) return expression;
  const operand = lastOperand(expression);
  if (operand.includes('.')) return expression;
  return operand === '' ? `${expression}0.` : `${expression}.`;
}

function pressOperator(expression: string, operator: Operator): string {
  // 先頭には置けない
  if (expression === '') return expression;
  const last = expression[expression.length - 1];
  if (isOperator(last)) return `${expression.slice(0, -1)}${operator}`;
  // `12.` の `.` は、演算子の前に落とす
  const base = last === '.' ? expression.slice(0, -1) : expression;
  return base.length >= MAX_EXPRESSION_LENGTH ? expression : `${base}${operator}`;
}

/** キーを1つ押したあとの式。受け付けないキー（桁あふれ、小数のない通貨の `.` など）は、式をそのまま返す。 */
export function pressKey(expression: string, key: ExpressionKey, minorUnit: number): string {
  switch (key) {
    case 'back':
      return expression.slice(0, -1);
    case '.':
      return pressDot(expression, minorUnit);
    case '+':
    case '-':
    case '*':
    case '/':
      return pressOperator(expression, key);
    case '00':
      // 0 を2回押したのと同じ（先頭の 0 は重ならない）
      return pressDigit(pressDigit(expression, '0', minorUnit), '0', minorUnit);
    default:
      return pressDigit(expression, key, minorUnit);
  }
}

/** 通貨の最小単位の整数から、式なしの入力文字列にする（編集で開くとき）。末尾の 0 の小数は落とす。 */
export function expressionFromAmount(amountMinor: number, minorUnit: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return '';
  if (minorUnit <= 0) return String(amountMinor);
  const unit = 10 ** minorUnit;
  const integer = Math.floor(amountMinor / unit);
  const fraction = String(amountMinor % unit).padStart(minorUnit, '0').replace(/0+$/, '');
  return fraction === '' ? String(integer) : `${integer}.${fraction}`;
}

/** 画面に出す式（整数部を3桁区切りにし、演算子を `+ − × ÷` にする）。 */
export function formatExpression(expression: string): string {
  return expression
    .replace(/(\d+)(\.\d*)?/g, (_match, integer: string, fraction: string | undefined) => {
      return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ?? ''}`;
    })
    .replace(/[-*/]/g, (operator) => (operator === '-' ? '−' : operator === '*' ? '×' : '÷'));
}

// --- 評価 ---

interface Rational {
  numerator: bigint;
  denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function normalize(value: Rational): Rational {
  const divisor = gcd(value.numerator, value.denominator);
  return divisor <= 1n ? value : { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

function parseNumber(text: string): Rational | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { numerator: BigInt(`${match[1]}${fraction}`), denominator: 10n ** BigInt(fraction.length) };
}

function apply(left: Rational, operator: Operator, right: Rational): Rational | null {
  switch (operator) {
    case '+':
      return normalize({
        numerator: left.numerator * right.denominator + right.numerator * left.denominator,
        denominator: left.denominator * right.denominator,
      });
    case '-':
      return normalize({
        numerator: left.numerator * right.denominator - right.numerator * left.denominator,
        denominator: left.denominator * right.denominator,
      });
    case '*':
      return normalize({ numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator });
    case '/':
      // 0 で割れない
      if (right.numerator === 0n) return null;
      return normalize({ numerator: left.numerator * right.denominator, denominator: left.denominator * right.numerator });
  }
}

export type ExpressionResult =
  /** 何も入力していない */
  | { kind: 'empty' }
  /** 計算できない（0で割った、桁あふれ、読めない式） */
  | { kind: 'invalid' }
  /** 通貨の最小単位の整数。式に演算子があれば `calculation`（式と結果を並べて出す） */
  | { kind: 'value'; minor: number; calculation: boolean };

/** 式を評価して、通貨の最小単位の整数にする（四捨五入。0以下・上限の検査は、呼び出し側）。 */
export function evaluateExpression(expression: string, minorUnit: number): ExpressionResult {
  // 末尾の演算子と `.` は、無いものとして扱う
  let text = expression;
  while (text.endsWith('.') || isOperator(text[text.length - 1])) text = text.slice(0, -1);
  if (text === '') return { kind: 'empty' };

  const numbers: Rational[] = [];
  const operators: Operator[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    if (index === text.length || isOperator(char)) {
      const number = parseNumber(text.slice(start, index));
      if (number === null) return { kind: 'invalid' };
      numbers.push(number);
      if (isOperator(char)) operators.push(char);
      start = index + 1;
    }
  }

  // `*` `/` を先に、左から。そのあと `+` `-` を左から
  const terms: Rational[] = [numbers[0]!];
  const sums: ('+' | '-')[] = [];
  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index]!;
    const next = numbers[index + 1]!;
    if (operator === '*' || operator === '/') {
      const result = apply(terms[terms.length - 1]!, operator, next);
      if (result === null) return { kind: 'invalid' };
      terms[terms.length - 1] = result;
    } else {
      sums.push(operator);
      terms.push(next);
    }
  }
  let total = terms[0]!;
  for (let index = 0; index < sums.length; index += 1) {
    const result = apply(total, sums[index]!, terms[index + 1]!);
    if (result === null) return { kind: 'invalid' };
    total = result;
  }

  // 最小単位へ。四捨五入（0から遠いほうへ。負の値は、登録できないので、向きは問わない）
  const scaled = total.numerator * 10n ** BigInt(Math.max(0, minorUnit));
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const rounded = (absolute * 2n + total.denominator) / (total.denominator * 2n);
  const minor = negative ? -rounded : rounded;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < -BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'invalid' };
  return { kind: 'value', minor: Number(minor), calculation: operators.length > 0 };
}

export type AmountState =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  /** 0以下 */
  | { kind: 'not-positive'; calculation: boolean }
  /** 1件の上限（10^12）を超える */
  | { kind: 'too-large'; calculation: boolean }
  | { kind: 'ok'; minor: number; calculation: boolean };

/** 式の評価に、保存できる金額か（1以上、10^12以下）の判定を足したもの。 */
export function amountState(expression: string, minorUnit: number): AmountState {
  const result = evaluateExpression(expression, minorUnit);
  if (result.kind !== 'value') return result;
  if (result.minor <= 0) return { kind: 'not-positive', calculation: result.calculation };
  if (result.minor > MAX_AMOUNT_MINOR) return { kind: 'too-large', calculation: result.calculation };
  return { kind: 'ok', minor: result.minor, calculation: result.calculation };
}
