// format.js —— 待办条目的格式化（纯函数，无副作用）
// 契约：所有输出必须是**单行**，且不含制表符（多行会破坏 CLI 列表对齐）。

/** 清单标题。 */
export function formatHeader(count) {
  return `待办清单（${count} 项）`;
}

/**
 * 单条待办。done 为真时前置 [x]，否则 [ ]。
 * @param {{id:number,text:string,done:boolean}} item
 */
export function formatItem(item) {
  const box = item.done ? '[x]' : '[ ]';
  return `${box} ${item.text}`;
}

/** 整个清单，逐行拼接；空清单返回提示行。 */
export function formatList(items) {
  if (items.length === 0) return '（暂无待办）';
  return [formatHeader(items.length), ...items.map(formatItem)].join('\n');
}
