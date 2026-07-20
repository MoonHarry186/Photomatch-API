import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './auth-context';
import { MetricsService } from './metrics.service';

@Controller('metrics')
@Public()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async get(@Res() response: Response): Promise<void> {
    response.type(this.metrics.registry.contentType).send(await this.metrics.render());
  }
}
