// Shared by the holiday service and the bundled homepage client.
const workTerms = /备课|课堂|课件|教学|教研|批改|成绩|作业|工作|任务|效率|高效|授课|上课|讲题|考试|绩效|业绩|加班|项目|汇报/u;
export const isWorkRelatedGreeting = text => workTerms.test(text);
export const isWarmGreeting = text => typeof text === 'string'
  && text.trim().length > 0
  && Array.from(text).length <= 28
  && !/[\n\r\p{Cc}\p{Cf}`<>]/u.test(text)
  && !isWorkRelatedGreeting(text);
