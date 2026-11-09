const messages = {
  'plan-class-conflict': 'その時間にはすでに授業が入っています。別のコマを選んでください。',
  'plan-overlap': 'その時間にはすでに別の準備の予定が入っています。別の時間を選んでください。',
  'plan-in-past': 'その時間はもう過ぎています。これからの時間を選んでください。',
  'plan-assignment-unavailable': 'この課題は提出済み、取り消し済み、または課題の一覧にないため、予定を入れられません。',
  'plan-after-deadline': '締切より後の予定は入れられません。締切までの日時を選んでください。',
  'plan-conflict': '予定が変わりました。学生の画面で確かめてください。',
};

export function planErrorCode(value: unknown): keyof typeof messages | undefined {
  return typeof value === 'string' && Object.hasOwn(messages, value) ? value as keyof typeof messages : undefined;
}

export function planErrorMessage(error: unknown, fallback: string) {
  const code = error instanceof Error ? planErrorCode(error.message) : undefined;
  return code ? messages[code] : fallback;
}
