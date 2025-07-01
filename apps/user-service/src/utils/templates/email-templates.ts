interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

export const createPasswordResetTemplate = (url: string): EmailTemplate => {
  const text = `안녕하세요, 아몬드영입니다.

회원님의 비밀번호 재설정 요청을 받았습니다.
아래 링크를 클릭하여 새로운 비밀번호를 설정해주세요.

${url}

본 링크는 5분간 유효하며, 이후에는 재발급이 필요합니다.
본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.

감사합니다.
아몬드영 드림`;

  const html = `
    <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333; margin-bottom: 20px;">비밀번호 재설정 안내</h2>
      <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">안녕하세요, 아몬드영입니다.</p>
      <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">회원님의 비밀번호 재설정 요청을 받았습니다.<br/>아래 버튼을 클릭하여 새로운 비밀번호를 설정해주세요.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #4A90E2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">비밀번호 재설정하기</a>
      </div>
      <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">본 링크는 5분간 유효하며, 이후에는 재발급이 필요합니다.<br/>본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #999; font-size: 12px;">본 메일은 발신전용입니다. 문의사항이 있으시면 고객센터를 이용해주세요.</p>
    </div>
  `;

  return {
    subject: '[아몬드영] 비밀번호 재설정 안내',
    text,
    html,
  };
};

export const createSignUpConfirmationTemplate = (
  url: string,
): EmailTemplate => {
  const text = `안녕하세요, 아몬드영입니다.

회원님의 가입 인증을 완료하려면 아래 링크를 클릭해주세요.

${url}

본 링크는 10분간 유효하며, 이후에는 재발급이 필요합니다.
본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.

감사합니다.
아몬드영 드림`;

  const html = `
    <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333; margin-bottom: 20px;">회원가입 이메일 인증</h2>
      <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">안녕하세요, 아몬드영입니다.</p>
      <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">회원님의 가입 인증을 완료하려면 아래 버튼을 클릭해주세요.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #4A90E2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">가입 인증하기</a>
      </div>
      <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">본 링크는 10분간 유효하며, 이후에는 재발급이 필요합니다.<br/>본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #999; font-size: 12px;">본 메일은 발신전용입니다. 문의사항이 있으시면 고객센터를 이용해주세요.</p>
    </div>
  `;

  return {
    subject: '[아몬드영] 회원가입 이메일 인증',
    text,
    html,
  };
};
