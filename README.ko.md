# Rusty

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/%40cheonghakim%2Frusty.js)](https://www.npmjs.com/package/@cheonghakim/rusty.js)

> Write JavaScript. Think in ownership.

[인터랙티브 데모 보기](https://cheonghakim.github.io/rusty.js/)

Rusty는 Rust의 ownership/borrow 검사를 JavaScript 문법이나 자료구조를 바꾸지 않고 그대로 가져옵니다.
객체, 배열, class, Promise를 지금 쓰던 그대로 씁니다. 여기에 `ref / mut / move / clone` 네 가지
작은 primitive를 추가해서, 값이 코드를 오가는 동안 누가 읽을 수 있는지, 누가 수정할 수 있는지,
지금 누가 소유하고 있는지를 정적으로 추적합니다.

TypeScript는 값의 모양을 검사합니다. Rusty는 그 값을 누가, 언제 건드려도 되는지를 검사합니다.
실무에서 발생하는 JS/TS 버그 중 상당수는 타입 불일치가 아닙니다. 어딘가에서 객체 참조를 들고 있는데,
다른 코드가 그 값을 바꾸는 경우입니다. 구조적 타이핑은 이런 문제를 볼 방법이 없습니다. Rusty가
겨냥하는 지점이 바로 여기입니다.

```js
const user = { name: "Summer", age: 30 };

send(move(user));

console.log(user.name);
// rusty/use-after-move
// `user`는 send()로 이동되어 이 지점에서 더 이상 사용할 수 없습니다.
```

이 프로젝트는 아직 PoC 단계입니다. 검증하려는 질문은 하나뿐입니다: `ref/mut/move`와 정적 분석만으로,
쓸만한 수준의 오탐률을 유지하면서 JavaScript의 진짜 ownership 버그를 잡을 수 있는가? 지금까지의
dogfooding 결과는 긍정적이지만([현재 상태](#현재-상태--한계) 참고), 아직 큰 실제 코드베이스에
돌려본 적은 없고 프로덕션에 바로 쓸 수 있는 수준도 아닙니다.

## 잡아내는 것

| 규칙                          | 예시                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `rusty/use-after-move`        | `move()` 이후 값을 다시 사용                                         |
| `rusty/maybe-use-after-move`  | 한쪽 분기에서만 이동된 값을 사용                                     |
| `rusty/double-mut-borrow`     | 동시에 두 개의 `mut()` borrow                                        |
| `rusty/mut-while-ref`         | `ref()`가 활성 상태인 동안 `mut()`                                   |
| `rusty/ref-while-mut`         | `mut()`가 활성 상태인 동안 `ref()`                                   |
| `rusty/move-while-borrowed`   | borrow가 활성 상태인 동안 `move()`                                   |
| `rusty/mutation-through-ref`  | `ref()`로 borrow된 값을 (원본을 통해서든 alias를 통해서든, 중첩 프로퍼티 포함) 직접 수정 |

borrow는 lexical scope가 아니라 lifetime을 기준으로 추적합니다(최신 Rust와 같은 non-lexical
lifetime 방식). 다시 읽히지 않는 `ref()`는 바로 해제되므로, 아래 코드는 오류로 잡히지 않습니다:

```js
{
  const r = ref(user);
  console.log(r.name);
}
update(mut(user)); // 정상, r의 borrow는 이미 끝남
```

정적으로 판단할 수 없는 경우(`setTimeout`으로 escape하는 클로저, contract가 없는 서드파티 호출,
동적 프로퍼티 접근, `Proxy`/`eval`)는 전부 `Unknown`으로 두고, 추측해서 오탐을 내는 대신 기본적으로
아무 것도 표시하지 않습니다.

## 패키지 하나, 세 가지 사용법

전부 npm 패키지 하나에 subpath export로 담겨 있어서, 버전도 설치도 하나만 신경 쓰면 됩니다 — 실제로
필요한 진입점만 가져다 쓰면 됩니다.

| 진입점                              | 용도                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `@cheonghakim/rusty.js`              | `ref`, `mut`, `move`, `clone`. 실제 배포되는 앱 코드에 들어가는 유일한 import. 의존성 없음.  |
| `@cheonghakim/rusty.js/eslint`       | ESLint flat config용 진단 플러그인. 분석 엔진까지 하나로 번들링돼 있음.                      |
| `rusty` (패키지의 bin)               | `rusty check`. CI나 일회성 검사용. 에러를 찾으면 non-zero exit.                             |

패키지 레벨에 `sideEffects: false`가 설정돼 있어서, 번들러는 실제로 import한 진입점만 가져갑니다 —
`@cheonghakim/rusty.js`만 import하면 ESLint 플러그인이나 그 안에 번들링된 분석 엔진은 전혀 딸려오지
않습니다.

## 빠른 시작

### 설치

```bash
npm install @cheonghakim/rusty.js
```

패키지 매니저는 상관없습니다 — `pnpm add`, `yarn add`, `bun add`도 명령어만 바꾸면 동일하게 동작합니다.

### 사용

```js
// eslint.config.js
import rusty from "@cheonghakim/rusty.js/eslint";

export default [rusty.configs.recommended];
```

```bash
npx rusty check         # 또는 설치돼 있다면: rusty check
```

```js
import { ref, mut, move } from "@cheonghakim/rusty.js";

render(ref(state));
update(mut(state));
send(move(state));
```

## 현재 상태 / 한계

초기 단계입니다. fixture 코퍼스와 직접 작성한 예제 파일 2개로만 검증했고, 실제 프로덕션
코드베이스에 돌려본 적은 없습니다. 결과를 맹신하지 말고 참고 자료로 보고 직접 검토하세요.

**쓰기 전에 꼭 알아야 할 한계 하나**: Rusty는 명시적으로 쓴 것만 추적합니다. 호출 지점에서
`value`를 `ref()`/`mut()`/`move()`로 감싸지 않고 그냥 `fn(value)`처럼 넘기면, `fn` 내부에서
그 값에 무슨 일이 일어나든 Rusty는 아무 판단도 하지 않습니다 — `fn` 안을 들여다보고 검사해주는
게 아니라 그냥 조용히 넘어갑니다. 함수/모듈 경계를 넘는 contract 전파가 아직 없기 때문입니다.
평범하게 값을 넘기는 함수 호출에서까지 ownership 버그를 잡아줄 거라고 기대하면 안 됩니다.

구현된 것:

- 단일 파일, 동기 코드 범위의 ownership/borrow 추적. `if`/`else`와 루프(2-pass 고정점)를 포함한
  실제 control-flow 병합
- 정적 alias 해석: `const a = b`, `ref()`/`mut()` aliasing, `clone()`/`move()`가 독립적인 owner를
  생성
- 지연 실행 콜백(`setTimeout`, 이벤트 핸들러)으로 escape하는 클로저는 `Escaped`로 표시하고 더 이상
  검사하지 않음. 오탐 위험을 만들지 않기 위한 선택

지금은 의도적으로 빠져 있는 것:

- class method의 mutation 추론
- 함수/모듈 경계를 넘는 contract 전파 (위 참고)
- async/await lifetime 정책
- LSP/VSCode 통합(inlay hint, hover)
- 자동 ownership 추론
- 패키지별 외부 contract(`*.rusty.json`)
- 조정 가능한 strictness 레벨. 지금은 고정된 프로파일 하나뿐

## 라이선스

MIT. 자세한 내용은 [LICENSE](./LICENSE) 참고.
