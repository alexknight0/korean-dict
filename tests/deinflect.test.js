// Run: node tests/deinflect.test.js
const assert = require("assert");
const D = require("../deinflect.js");

const cases = {
  먹었는데: "먹다", 먹어요: "먹다", 먹었어요: "먹다", 먹습니다: "먹다", 먹으면: "먹다", 먹은: "먹다",
  먹겠습니다: "먹다", 가요: "가다", 갔어요: "가다", 갑니다: "가다", 간다: "가다", 가는: "가다",
  가세요: "가다", 가셨어요: "가다", 했어요: "하다", 해요: "하다", 합니다: "하다", 봐요: "보다",
  봤어: "보다", 줘요: "주다", 돼요: "되다", 써요: "쓰다", 마셔요: "마시다", 보내요: "보내다",
  추워요: "춥다", 추운: "춥다", 추우면: "춥다", 도와요: "돕다", 들어요: "듣다", 들으면: "듣다",
  몰라요: "모르다", 불러요: "부르다", 사는: "살다", 살아요: "살다", 삽니다: "살다", 나아요: "낫다",
  그래요: "그렇다", 그런: "그렇다", 파래요: "파랗다", 공부했어요: "공부", 학교에서: "학교",
  학생이에요: "학생", 친구를: "친구", 나는: "나", 날: "나", 먹고: "먹다", 먹지만: "먹다",
  예뻐요: "예쁘다", 아파서: "아프다", 기다렸어요: "기다리다", 배웠어요: "배우다", 지어요: "짓다",
};
let fail = 0;
for (const [form, want] of Object.entries(cases)) {
  const got = D.candidates(form);
  if (!got.includes(want)) { fail++; console.log(`FAIL ${form} -> ${want}; got ${got.join(",")}`); }
}
console.log(`${Object.keys(cases).length - fail}/${Object.keys(cases).length} passed`);
assert.strictEqual(fail, 0);
