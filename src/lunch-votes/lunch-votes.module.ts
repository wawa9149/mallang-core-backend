import { Module } from '@nestjs/common';
import { LunchVotesController } from './lunch-votes.controller';
import { LunchVotesService } from './lunch-votes.service';

@Module({
  controllers: [LunchVotesController],
  providers: [LunchVotesService],
})
export class LunchVotesModule {}
