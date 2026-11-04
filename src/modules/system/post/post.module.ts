import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { PostEntity } from './entities/post.entity'
import { PostService } from './post.service'
import { PostV1Controller } from './post.v1.controller'

@Module({
  imports: [TypeOrmModule.forFeature([PostEntity])],
  controllers: [PostV1Controller],
  providers: [PostService],
  exports: [PostService, TypeOrmModule]
})
export class PostModule {}
