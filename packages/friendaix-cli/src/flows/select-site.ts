import { homedir } from 'node:os';
import {
  cancel,
  intro,
  isCancel,
  outro,
  select,
  spinner,
} from '@clack/prompts';
import pc from 'picocolors';
import { pingAll } from '../sites.js';
import { writeState } from '../state.js';

export async function runSelectSite(homeDir = homedir()): Promise<void> {
  intro(pc.cyan(' 选择默认线路 '));
  const speedSpinner = spinner();
  speedSpinner.start('正在检查线路');
  const results = await pingAll();
  speedSpinner.stop('线路检查完成');

  const available = results.filter((result) => result.ok);
  if (available.length === 0) {
    cancel('没有可用线路，默认线路未改变。');
    return;
  }
  const selection = await select<string>({
    message: '选择快速配置优先使用的线路',
    options: available.map((result) => ({
      value: result.site.id,
      label: result.site.name,
      hint: `${result.latencyMs}ms`,
    })),
  });
  if (isCancel(selection)) {
    cancel('已取消。');
    return;
  }
  const selected = available.find((result) => result.site.id === selection)!;
  await writeState({ selectedSite: selected.site.id }, homeDir);
  outro(pc.green(`默认线路已设为 ${selected.site.name}`));
}
