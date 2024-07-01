// ==UserScript==
// @name         rewrite canvas
// @version      0.1.0
// @author       icely450050766
// @include      *
// @grant        GM_xmlhttpRequest
// @run-at document-start
// ==/UserScript==

(function () {
  'use strict';
  console.log('rewrite canvas');

  // 存放多页 行数据
  let allLines = [];
  // texts 最大y值
  let maxTextsY = 0;

  const nextPage = nextPageWrapper(0);

  const debounceAction = debounce((texts, clearTextsFn) => {
    if (!texts.length) return;

    // 一直翻页，把所有数据提取出来
    const isSuccess = nextPage();

    // 行格式化数据
    const lines = lineFormat(groupByLineAndFont(texts));

    // 偏差，用于处理一段分开两页显示的情况
    let diff = 0;
    if (allLines.length) {
      const [line, { font }] = allLines[allLines.length - 1];
      const [line0, { font: font0, x: x0 }] = lines[0];
      diff = line;

      // font一致，且x坐标为0，认为是同一段 
      // todo 可能有问题
      if (font === font0 && x0 === 0) {
        // 以上一页行距为标准
        if (allLines.length >= 2) {
          diff += line - allLines[allLines.length - 2][0] - line0;

          // 以当前页行距为标准
        } else if (lines.length >= 2) {
          diff += lines[1][0] - line0 - line0
        }
      }
    }

    // console.log(111, diff, lines)

    // 把当前页的 texts 的 y 坐标加上 diff
    const newLines = lines.map(([line, value]) => ([
      // 可能有浮点数加减的问题
      line + diff,
      value
    ]))

    allLines.push(...newLines);
    console.log(222, newLines, allLines);

    // 获取段数据
    const data = groupByParagraph(allLines);

    // 清空 texts，准备获取下一页数据
    clearTextsFn?.();

    if (!isSuccess) {
      const div = getHtmlStr(data);
      document.body.appendChild(div);
      console.log(data, div);

      allLines = [];
      allLines = {}; // todo delete
    } else {
      console.log(data)
    }
  })

  // [text, x, y, font][]
  // const texts = [];
  const texts = new Proxy([], {
    get: function (obj, prop) {
      return obj[prop];
    },
    set: function (obj, prop, value) {
      // 特殊逻辑，有时候有这个case：请求一页数据，返回了上几页~当前页的所有数据
      // 例如：本页之前的页的最后一条数据的 y为400，当前页第一条数据 y为100，导致拼接出来的数据混乱
      // 所以这种情况统一清空 tests
      if (Array.isArray(value)) {
        const [text, x, y, font] = value;
        if (y && maxTextsY > Number(y)) {
          obj.length = 0;
        }
      }

      obj[prop] = value;

      // 记录y最大值
      maxTextsY = Math.max(0, ...obj.map(([text, x, y, font]) => Number(y)));

      // 延时解析
      debounceAction(obj, () => { obj.length = 0; });

      // 表示成功
      return true;
    },
  });

  /**
   * 防抖
   * @param fn 处理函数
   * @param wait 等待时间 ms
   * @returns 延时执行的函数
   */
  function debounce(fn, wait = 500) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        fn.apply(null, args);
      }, wait)
    }
  }

  /**
   * 重写函数 drawImage、fillText
   */
  function rewriteFillText() {
    const originDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    const originFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.drawImage = function (image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight) {
      console.log('originDrawImage')
      if (image instanceof Image) {
        texts.push([image])
      }

      // 调用原方法保持正常绘制
      originDrawImage.apply(this, arguments)
    }
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      console.log(text, x, y)
      texts.push([text, x, y, this.font])
      originFillText.apply(this, [text, x, y])
    }
  }

  /**
   * 根据行和样式分组
   * @param texts [text, x, y, font][]
   * @returns {[line: number]: {font: string, text: string，x: number, xMax: number}[]}
   */
  function groupByLineAndFont(texts) {
    if (!texts.length) return [];

    const lines = {};
    texts.forEach(([text, x, y, font]) => {
      lines[y] = lines[y] || [];
      const lineLength = lines[y].length;

      // 根据字体样式分组（支持一行包含不同的字体）
      if (lineLength > 0 && lines[y][lineLength - 1].font === font) {
        lines[y][lineLength - 1].text += text;
        // xMax代表该行文字的 x最大值，相当于最右边的文字的 x坐标
        lines[y][lineLength - 1].xMax = Math.max(x, lines[y][lineLength - 1].xMax);
      } else {
        lines[y].push({ font, text, x, xMax: x });
      }
    });
    return lines;
  }

  /**
   * 一行格式化（支持一行内文本多样式）
   * @param lines {[line: number]: {font: string, text: string, x: number, xMax: number}[]}
   * @returns [line: number, {font: string, html: string, x: number, xMax: number}][]
  */
  function lineFormat(lines) {
    // {[line: number]: {font: string, html: string, x: number}}
    const lineMap = {};

    Object.entries(lines).map(([line, value]) => {
      // font权重
      const weight = value.reduce((pre, { font, text }) => {
        pre[font] = pre[font] || 0;
        pre[font] += text.length;
        return pre;
      }, {});

      // 本行的主体font
      const mainFont = Object.entries(weight)
        .reduce((pre, [font, length]) => {
          if (pre.length < length) {
            return { font, length }
          }
          return pre;
        }, { font: '', length: 0 })
        .font;

      // 本行html
      const html = value.reduce((pre, { font, text }) => {
        if (font === mainFont) return pre += text;
        return pre += `<span style="font: ${font}">${text}</span>`;
      }, '');

      lineMap[line] = {
        font: mainFont,
        html,
        x: Number(value[0].x),
        xMax: value[value.length - 1].xMax
      }
    });

    return Object.entries(lineMap)
      // 行传数字
      .map(([line, value]) => ([+line, value]))
      // 行升序
      .sort((a, b) => (a[0] - b[0]));;
  }

  /**
   * 把行合并成段
   * @param linesEntries [line: number, {font: string, html: string, x: number, xMax: number}][]
   * @returns {font: string, html: string, marginTop: number}[]
   */
  function groupByParagraph(linesEntries) {
    if (!linesEntries.length) return [];

    const paragraphs = [];
    let diff = -1; // -1表示新的一段

    linesEntries.forEach(([line, { font, html, x, xMax }], index) => {
      // 本行和上一行之间的距离
      const newDiff = index > 0 ? line - linesEntries[index - 1][0] : -1;
      // 上一行 xMax
      const lastLineXMax = index > 0 ? linesEntries[index - 1][1].xMax : -1;

      // -1表示上一轮开启新的一段，diff记录这一段文字的行距
      if (diff === -1) {
        diff = newDiff
      }

      if (newDiff === diff &&
        // x坐标不为0，则当一个新段落处理
        x === 0 &&
        // paragraphs没有数据，则当一个新段落处理
        paragraphs.length > 0 &&
        // 若本行字体和上一段字体不一样，则当一个新段落处理
        // todo font一致归为同一段，可能有问题
        font === paragraphs[paragraphs.length - 1].font &&
        // 本行x最大值 比 上一行的x最大值 多于2个字符长度，认为上一行内容没有完全充满一行，则当一个新段落处理（解决：标题有且只有一行的，且和正文字体一致，避免把正文第一行和标题拼接成一段）
        // todo 2个字符
        lastLineXMax > 0 && xMax - lastLineXMax < 50) {
        paragraphs[paragraphs.length - 1].html += html;
        return;
      }

      // 新建一段
      diff = -1;
      paragraphs.push({ font, html, marginTop: Math.max(0, newDiff) });
    })
    return paragraphs;
  }

  /**
   * 
   * @param paragraphs {font: string, html: string, marginTop: number}[]
   * @returns string
   */
  function getHtmlStr(paragraphs) {
    const div = document.createElement('div');
    div.style.background = 'yellow';
    div.style.color = '#000';
    div.style.padding = '10px';
    div.style.width = '100%';
    div.style.height = '100px';
    div.style.overflow = 'auto';
    div.style.position = 'fixed';
    div.style.left = 0;
    div.style.right = 0;
    div.style.top = 0;
    div.style.zIndex = 100;

    paragraphs.forEach(({ font, html, marginTop }) => {
      const p = document.createElement('p');
      p.style.font = font;
      p.style.marginBottom = `${'10'}px`;
      p.innerHTML = html;
      div.appendChild(p)
    });
    return div;
  }

  /**
   * 下一页
   * @param size 页数
   * @return 跳转下一页函数
   */
  function nextPageWrapper(size) {
    let index = 0;
    return () => {
      if (index >= size) return false;

      index += 1;
      const btn = document.querySelector('.renderTarget_pager_button.renderTarget_pager_button_right');
      console.log(btn);
      btn?.click();

      return true;
    }
  }

  rewriteFillText();
})();