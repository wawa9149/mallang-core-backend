import { Module } from '@nestjs/common';
import { VisitRecordsController } from './visit-records.controller';
import { VisitRecordsService } from './visit-records.service';

@Module({
  controllers: [VisitRecordsController],
  providers: [VisitRecordsService],
})
export class VisitRecordsModule {}
