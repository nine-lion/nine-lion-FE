module.exports = {
  arrowParens: 'always', //화살표 함수의 매개변수에 항상 괄호를 붙임
  htmlWhitespaceSensitivity: 'css', //HTML의 공백 처리 방식을 CSS 규칙에 따름
  bracketSameLine: false, //JSX/HTML의 닫는 >를 다음 줄에 배치
  bracketSpacing: true, //객체의 중괄호 안에 공백 추가
  proseWrap: 'preserve', //Markdown 문장의 줄바꿈 유지
  quoteProps: 'as-needed', //필요한 경우에만 객체 키를 따옴표로 감쌈
  semi: true, //문장 끝에 세미콜론 사용
  singleQuote: true, //문자열에 작은따옴표 사용
  tabWidth: 2, //들여쓰기 크기
  trailingComma: 'all', //가능한 모든 곳에 후행 쉼표(trailing comma)를 붙이는 설정
  plugins: ['prettier-plugin-tailwindcss'], // 프리티어 자동정렬
  useTabs: false, //Tab 대신 Space 사용
};
