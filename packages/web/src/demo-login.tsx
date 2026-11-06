export function DemoLogin({ returnTo }: { returnTo?: string | undefined }) {
  return <div className="demo-login">
    <p>体験用のアカウントで試す方は、体験用LMSからログインしてください。</p>
    <a className="plain-button" href={returnTo ? `/demo-lms?returnTo=${encodeURIComponent(returnTo)}` : '/demo-lms'}>体験用LMSからログイン</a>
    <h2>Googleアカウントで使う方</h2>
  </div>;
}
