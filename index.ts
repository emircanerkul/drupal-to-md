import { Browser, chromium, Page } from "playwright";
import { NodeHtmlMarkdown, PostProcessResult } from 'node-html-markdown'
import yaml from 'js-yaml'
import fse from 'fs-extra'

const baseUrl = 'https://www.drupal.org';

async function main() {
    const browser = await chromium.launch({
        headless: false,
        channel: "msedge"
    });

    await crawl({ title: 'Drupal', browser: browser, initial: true });
    // await crawl({ title: 'Step 2: Install dependencies with composer', path: '/docs/installing-drupal/step-2-install-dependencies-with-composer', browser: browser, initial: false }); // Will lost hierarchy

    await browser.close();
}
const crawl = async ({ title, browser, path = '/docs', index = 0, dir = [], initial = false }: {
    title: string,
    browser: Browser,
    path?: string,
    index?: number,
    dir?: string[],
    initial?: boolean,
}) =>
    new Promise(async (res, rej) => {
        if (
            [
                '/docs/contributed-modules',
            ].includes(path)) {
            res(true);
            return;
        }

        dir.push(`${initial ? '' : index + ') '}${title}`);

        let outputPath = 'dist/' + dir.join('/');

        if (fse.pathExistsSync(outputPath + '/readme.md')) {
            res(true);
            console.log('sad');

            return;
        }

        let frontmatter: any = {}
        const page = await browser.newPage();
        await page.goto(baseUrl + path);
        await page.waitForSelector('.column-content-region-inner.left-content-inner');

        let bodyEl = await page.$(".panel-pane.pane-entity-field.pane-node-body .field-name-body, .panel-pane.pane-entity-field.pane-node-body .field-name-body");

        await bodyEl?.evaluate(el => {
            const elements = el.getElementsByClassName('toc-anchor');
            while (elements.length > 0 && elements != null && elements[0].parentNode != null) {
                elements[0].parentNode.removeChild(elements[0]);
            }
            return el;
        });

        let parts: { title: string, html: string, prevHtml: string }[] = [];
        if (bodyEl) {
            parts = await bodyEl.$$eval(".field-item h2", (els) => {
                return els.map((el, i) => {
                    let title = el.textContent;
                    let next: any = el.nextElementSibling;
                    let html = '';
                    let prevHtml = '';

                    do {
                        html = html + next?.outerHTML;
                        next = next?.nextElementSibling;
                    } while (next != null && next != undefined && next.nodeName != 'H2');


                    if (i == 0) {
                        let prev: any = el.previousElementSibling;

                        if (prev != null) do {
                            prevHtml = prev?.outerHTML + prevHtml;
                            prev = prev?.previousElementSibling;
                        } while (prev != null && prev != undefined && prev.nodeName != 'H2');
                    }

                    return {
                        title: `${i}) ${title}`,
                        html,
                        prevHtml
                    }
                });
            });
        }

        for (const meta of ['og:url', 'og:description', 'article:published_time', 'article:modified_time']) {
            let metaEls = await page.$(`meta[property='${meta}']`);
            frontmatter[meta.split(':')[1]] = await metaEls?.getAttribute('content')
        }

        let documentationStatus = await page.$(".panel-pane.pane-entity-field.pane-node-body .field-name-field-documentation-status");
        if (documentationStatus) {
            let documentationStatusMD = NodeHtmlMarkdown.translate(await documentationStatus.innerHTML());
            frontmatter.documentation_status = documentationStatusMD
        }

        let sections = await page.$$(".panel-pane.pane-section-contents .pane-content section");
        if (sections) {
            for (const [section_index, section] of sections.entries()) {
                let sectionLink = await section.$('h2 a');

                let sectionLinkHref = await sectionLink?.getAttribute('href')
                let sectionLinkTitle = await sectionLink?.innerText();

                if (sectionLinkHref && sectionLinkTitle)
                    await crawl({
                        browser,
                        title: sectionLinkTitle.replace(/\//g, '／').replace(/\\/g, '＼').replace(/\?/g, '？').replace(/\!/g, '！').replace(/(?:^(?:&nbsp;)+)|(?:(?:&nbsp;)+$)/g, ''),
                        path: sectionLinkHref,
                        index: section_index,
                        dir: dir.slice(0)
                    });
            }
        }

        if (parts.length != 0) {
            parts.forEach((part, part_index) => {
                if (part_index == 0) {
                    fse.outputFileSync(`${outputPath}/readme.md`, `---\n${yaml.dump(frontmatter)}---\n${htmlToMD(part.prevHtml)}`)
                }

                fse.outputFileSync(`${outputPath}/${part.title}/readme.md`, htmlToMD(part.html))
            });
        }
        else {
            fse.outputFileSync(`${outputPath}/readme.md`, `---\n${yaml.dump(frontmatter)}---\n${htmlToMD(await bodyEl?.innerHTML())}`)
        }

        await page.close()
        res(true);
    });

function htmlToMD(html: string = '') {
    return NodeHtmlMarkdown.translate(html, {}, {
        div: {
            postprocess: ({ node }) => {
                for (const className of node.classList.values()) {
                    if (className.substring(0, 5) == "note-") {
                        return `<!-- ${className} -->\n> ${className.substring(5).toUpperCase()}: ${node.innerText.trimStart()}`;
                    }
                }

                return PostProcessResult.NoChange;
            }
        },
        img: {
            postprocess: ({ node }) => {
                let src = node.getAttribute('src');
                if (src && src.indexOf('/') == 0)
                    return `![${node.getAttribute('alt')}](${baseUrl + src})`;
                return PostProcessResult.NoChange;
            }
        }
    });
}

main();